import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import { PostgresStoreVNext } from '@mastra/pg';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createTool } from '@mastra/core/tools';
import { SpanType } from '@mastra/core/observability';
import { LocalFilesystem, LocalSandbox } from '@mastra/core/workspace';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import {
  createMainSession,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';
import { CodeModeProcessor } from '../dist/agent/code-mode.processor.js';
import { telemetryRetention } from '../dist/agent/run-telemetry.js';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@localhost:5433/pal_test';
if (!new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database must end in _test');
const finish = (tool = false) => ({
  type: 'finish' as const,
  finishReason: {
    unified: tool ? ('tool-calls' as const) : ('stop' as const),
    raw: undefined,
  },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
});
const text = (value: string) => [
  { type: 'text-start' as const, id: 'text' },
  { type: 'text-delta' as const, id: 'text', delta: value },
  { type: 'text-end' as const, id: 'text' },
];

it('persists selective native run and code-mode evidence readable without schema writes', async () => {
  const schema = 'pal_telemetry_' + randomUUID().replaceAll('-', '');
  const auditRole = 'pal_audit_' + randomUUID().replaceAll('-', '');
  const directory = await mkdtemp(join(tmpdir(), 'pal-telemetry-'));
  const sentinel = 'secret-payload-sentinel';
  let calls = 0;
  let main: Awaited<ReturnType<typeof createMainSession>> | undefined;
  let reader: PostgresStoreVNext | undefined;
  const publications: string[] = [];
  const memoryModel = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          ...text(
            '<observations>Fixture task retains attributed evidence.</observations><current-task>Complete fixture.</current-task>',
          ),
          finish(),
        ],
      }),
    }),
  });
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks:
          ++calls === 1
            ? [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'code-call',
                  toolName: 'execute_typescript',
                  input: JSON.stringify({
                    code: `try { await external_probe({ value: '${sentinel}' }); } catch {} return 'done';`,
                  }),
                },
                finish(true),
              ]
            : [...text('Unstructured fixture response'), finish()],
      }),
    }),
  });
  try {
    main = await createMainSession({
      connectionString: databaseUrl,
      schemaName: schema,
      releaseId: 'fixture-release',
      workingDirectory: directory,
      filesystem: new LocalFilesystem({ basePath: directory }),
      sandbox: new LocalSandbox({ workingDirectory: directory }),
      model,
      memoryOptions: {
        lastMessages: 10,
        semanticRecall: false,
        observationalMemory: {
          model: memoryModel,
          scope: 'thread',
          observation: { messageTokens: 100, bufferTokens: false },
          reflection: { observationTokens: 10000 },
        },
      },
      tools: {},
      onEvent: () => {},
      task: {
        instructions: 'Fixture task',
        inputProcessors: [new CodeModeProcessor()],
        publish: async (output) => {
          publications.push(output.text);
        },
        tools: {
          probe: createTool({
            id: 'probe',
            description: 'Fail fixture',
            inputSchema: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false,
            },
            execute: async () => {
              throw Error(sentinel);
            },
          }),
        },
      },
    });
    const threadId = 'pal-task:telemetry-fixture';
    const seed = (await main.storage.getStore('memory'))!;
    await seed.saveThread({
      thread: {
        id: threadId,
        resourceId: MAIN_RESOURCE_ID,
        title: 'Fixture',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await seed.saveMessages({
      messages: [
        {
          id: randomUUID(),
          threadId,
          resourceId: MAIN_RESOURCE_ID,
          role: 'user',
          type: 'text',
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [{ type: 'text', text: 'Earlier evidence '.repeat(300) }],
          },
        },
      ],
    });
    const requestContext = new RequestContext([
      [MASTRA_THREAD_ID_KEY, threadId],
      [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
    ]);
    const output = await main.taskAgent!.stream('User request ' + sentinel, {
      memory: { thread: threadId, resource: MAIN_RESOURCE_ID },
      requestContext,
    });
    await output.getFullOutput();
    const injected = main.telemetry.observability
      .getDefaultInstance()!
      .startSpan({
        type: SpanType.GENERIC,
        name: sentinel,
        input: { password: sentinel },
        attributes: { nested: { secret: sentinel } },
        metadata: { nested: { secret: sentinel } },
      });
    injected.error({ error: Error(sentinel), endSpan: true });
    main.telemetry.record('pal.memory.sample', {
      phase: 'idle',
      idleForMs: 120_000,
      activeTaskRuns: 0,
      activeWorkerRuns: 0,
      rssBytes: 101,
      heapUsedBytes: 102,
    });
    main.telemetry.record('pal.model.request', {
      role: 'task',
      messageCount: 12,
      imagePartCount: 3,
      estimatedRequestBytes: 456,
      promptBytes: 400,
      secret: sentinel,
    });
    await main.telemetry.observability.flush();
    expect(publications).toEqual(['Unstructured fixture response']);
    const fixtureStorage = main.storage;
    const observationStore = (await fixtureStorage.getStore('observability'))!;
    const failedExport = vi
      .spyOn(observationStore, 'batchCreateLogs')
      .mockRejectedValue(Error(sentinel));
    main.telemetry.record('pal.publication', {
      runId: output.runId,
      messageRef: 99,
    });
    await expect(main.telemetry.observability.flush()).resolves.toBeUndefined();
    expect(failedExport).toHaveBeenCalled();
    failedExport.mockRestore();
    await main.close();
    main = undefined;
    const permissions = new Pool({ connectionString: databaseUrl });
    try {
      await permissions.query(`CREATE ROLE "${auditRole}" NOLOGIN`);
      await permissions.query(
        `GRANT USAGE ON SCHEMA "${schema}" TO "${auditRole}"`,
      );
      await permissions.query(
        `GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${auditRole}"`,
      );
    } finally {
      await permissions.end();
    }
    const reads = new Pool({
      connectionString: databaseUrl,
      options: `-c role=${auditRole} -c default_transaction_read_only=on`,
    });
    reader = new PostgresStoreVNext({
      id: 'read-only-audit',
      pool: reads,
      schemaName: schema,
      disableInit: true,
      observability: { pool: reads, schemaName: schema },
    });
    try {
      const privilege = await reads.query(
        'SELECT current_user AS actor, has_schema_privilege(current_user, $1, $2) AS can_create',
        [schema, 'CREATE'],
      );
      expect(privilege.rows[0]).toEqual({
        actor: auditRole,
        can_create: false,
      });
      const observations = (await reader.getStore('observability'))!;
      const traces = await observations.listTraces({
        filters: { runId: output.runId },
        pagination: { page: 0, perPage: 20 },
      });
      const trace = await observations.getTrace({
        traceId: traces.spans[0]!.traceId,
      });
      const errorTrace = await observations.getTrace({
        traceId: injected.traceId,
      });
      expect(JSON.stringify(errorTrace)).not.toContain(sentinel);
      const logs = await observations.listLogs({
        pagination: { page: 0, perPage: 100 },
      });
      expect(traces.spans.length).toBeGreaterThan(0);
      expect(traces.spans[0]).toMatchObject({ runId: output.runId, threadId });
      expect(trace?.spans.some((span) => span.spanType === 'tool_call')).toBe(
        true,
      );
      expect(
        trace?.spans.find((span) => span.spanType === 'tool_call')?.entityId,
      ).toBe('execute_typescript');
      expect(
        trace?.spans.some(
          (span) =>
            span.spanType === 'model_generation' && span.attributes?.usage,
        ),
      ).toBe(true);
      expect(
        logs.logs.some(
          (log) =>
            log.message === 'code-mode external result' &&
            log.level === 'error' &&
            log.data?.tool === 'probe',
        ),
      ).toBe(true);
      expect(
        logs.logs.some(
          (log) =>
            log.message === 'pal.model.request' &&
            log.data?.role === 'task' &&
            log.data?.messageCount === 12 &&
            log.data?.imagePartCount === 3 &&
            log.data?.estimatedRequestBytes === 456 &&
            log.data?.promptBytes === 400 &&
            log.data?.secret === undefined,
        ),
      ).toBe(true);
      expect(
        logs.logs.some((log) => log.message === 'pal.output.fallback'),
      ).toBe(true);
      expect(
        logs.logs.some(
          (log) =>
            log.message === 'data-om-observation-end' &&
            typeof log.data?.tokensObserved === 'number',
        ),
      ).toBe(true);
      expect(
        logs.logs.some(
          (log) =>
            log.message === 'pal.memory.sample' &&
            log.data?.phase === 'idle' &&
            log.data?.idleForMs === 120_000 &&
            log.data?.activeTaskRuns === 0 &&
            log.data?.activeWorkerRuns === 0 &&
            log.data?.rssBytes === 101 &&
            log.data?.heapUsedBytes === 102 &&
            log.data?.runId === undefined &&
            log.data?.taskId === undefined &&
            log.data?.workerId === undefined,
        ),
      ).toBe(true);
      expect(JSON.stringify({ traces, trace, logs })).not.toContain(sentinel);
      expect(JSON.stringify({ traces, trace, logs })).not.toContain(
        'Unstructured fixture response',
      );
      expect(JSON.stringify({ traces, trace, logs })).toContain(
        'fixture-release',
      );
      const memory = (await reader.getStore('memory'))!;
      const messages = await memory.listMessages({
        threadId,
        perPage: 20,
        page: 0,
      });
      expect(JSON.stringify(messages)).toContain(sentinel);
      await expect(
        reads.query('CREATE TABLE should_not_exist (id int)'),
      ).rejects.toThrow(/read-only/);
      const guide = await readFile(
        new URL('../../architecture/agent-run-queries.md', import.meta.url),
        'utf8',
      );
      const snippet = guide
        .split('```js\n')[1]
        .split('```')[0]
        .replaceAll("schemaName: 'mastra'", `schemaName: '${schema}'`);
      const inspected = spawnSync(process.execPath, ['--input-type=module'], {
        input: snippet,
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(inspected.stderr).not.toContain('Error');
      expect(inspected.status).toBe(0);
      expect(inspected.stdout).toContain('pal-task-agent');
    } finally {
      await reader.close();
      reader = undefined;
      await reads.end();
    }
  } finally {
    await reader?.close();
    await main?.close();
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.query(`DROP ROLE IF EXISTS "${auditRole}"`);
    } finally {
      await pool.end();
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it('prunes old telemetry partitions while preserving conversation and memory records', async () => {
  const schema = 'pal_retention_' + randomUUID().replaceAll('-', '');
  const storage = new PostgresStoreVNext({
    id: 'retention-fixture',
    connectionString: databaseUrl,
    schemaName: schema,
    observability: {
      connectionString: databaseUrl,
      schemaName: schema,
      partitioning: { mode: 'native' },
    },
    retention: telemetryRetention,
  });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await storage.init();
    const memory = (await storage.getStore('memory'))!;
    const old = new Date(Date.now() - 40 * 86_400_000);
    const oldDay = old.toISOString().slice(0, 10);
    const nextDay = new Date(old.getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const suffix = oldDay.replaceAll('-', '');
    for (const table of ['mastra_span_events', 'mastra_log_events']) {
      await pool.query(
        `CREATE TABLE "${schema}"."${table}_p${suffix}" PARTITION OF "${schema}"."${table}" FOR VALUES FROM ('${oldDay}') TO ('${nextDay}')`,
      );
    }
    await memory.saveThread({
      thread: {
        id: 'retained-thread',
        resourceId: MAIN_RESOURCE_ID,
        title: 'Fixture',
        metadata: {},
        createdAt: old,
        updatedAt: old,
      },
    });
    await memory.saveMessages({
      messages: [
        {
          id: 'retained-message',
          threadId: 'retained-thread',
          resourceId: MAIN_RESOURCE_ID,
          role: 'user',
          createdAt: old,
          type: 'text',
          content: {
            format: 2,
            parts: [{ type: 'text', text: 'Retained evidence' }],
          },
        },
      ],
    });
    await memory.initializeObservationalMemory({
      threadId: 'retained-thread',
      resourceId: MAIN_RESOURCE_ID,
      scope: 'thread',
      config: {},
    });
    const observations = (await storage.getStore('observability'))!;
    for (const date of [old, new Date()]) {
      await observations.createSpan({
        span: {
          traceId: randomUUID().replaceAll('-', ''),
          spanId: randomUUID().replaceAll('-', '').slice(0, 16),
          name: 'fixture',
          spanType: SpanType.AGENT_RUN,
          isEvent: false,
          startedAt: date,
          endedAt: date,
        },
      });
      await observations.batchCreateLogs({
        logs: [
          {
            logId: randomUUID(),
            timestamp: date,
            level: 'info',
            message: date === old ? 'old' : 'current',
          },
        ],
      });
    }
    const pruned = await storage.prune({ maxBatches: 2 });
    expect(pruned.every((item) => item.domain === 'observability')).toBe(true);
    expect(
      pruned.reduce((total, item) => total + item.deleted, 0),
    ).toBeGreaterThanOrEqual(2);
    expect(
      (await observations.listTraces({ pagination: { page: 0, perPage: 20 } }))
        .spans,
    ).toHaveLength(1);
    expect(
      (
        await observations.listLogs({ pagination: { page: 0, perPage: 20 } })
      ).logs.map((log) => log.message),
    ).toEqual(['current']);
    expect(
      (
        await memory.listMessages({
          threadId: 'retained-thread',
          page: 0,
          perPage: 20,
        })
      ).messages,
    ).toHaveLength(1);
    expect(
      await memory.getObservationalMemory('retained-thread', MAIN_RESOURCE_ID),
    ).not.toBeNull();
  } finally {
    await storage.close();
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});

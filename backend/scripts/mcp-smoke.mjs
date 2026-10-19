import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { MCPClient } from '@mastra/mcp';
import { createCodeModeInstructions, generateStubs } from '@mastra/core/tools';
import { noopLogger } from '@mastra/core/logger';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import { startMcpFixture } from '../test/mcp-fixture.ts';
import {
  createMainSession,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { mainTaskTools } from '../dist/agent/task-tools.js';
import { toolsOnlyFetch } from '../dist/mcp/tools-only-fetch.js';
import { TaskToolDiscoveryProcessor } from '../dist/agent/task-tool-discovery.processor.js';

// Real-model check with synthetic service data and isolated memory, leaving
// the owner's chats and connected-service credentials untouched.
const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@localhost:5433/pal_test';
if (!new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Smoke database name must end in _test');
const schemaName = 'mcp_smoke_' + randomUUID().replaceAll('-', '');
const workingDirectory = await mkdtemp(join(tmpdir(), 'pal-mcp-smoke-'));
const remote = await startMcpFixture();
const client = new MCPClient({
  id: schemaName,
  servers: {
    fixture: {
      url: new URL(remote.origin + '/public'),
      fetch: toolsOnlyFetch,
      enableServerLogs: false,
    },
  },
});
client.__setLogger(noopLogger);
const taskId = randomUUID();
const threadId = 'pal-task:' + taskId;
const runs = [];
const taskPublications = [];
const mainPublications = [];
const taskToolCalls = [];
let main;
let failed = false;
let acknowledgedAt;
let firstFinalAt;
const catalogSteps = [];
let fullMcpCatalogEstimatedTokens;
const startedAt = Date.now();
const timeout = setTimeout(() => {
  console.error('MCP smoke timed out');
  process.exit(1);
}, 180000);
try {
  const mcpTools = await client.listTools();
  fullMcpCatalogEstimatedTokens = Math.ceil(
    createCodeModeInstructions({ tools: mcpTools }).length / 4,
  );
  const taskInstructions = await loadAgentInstructions('task');
  const requestContext = new RequestContext([
    [MASTRA_THREAD_ID_KEY, threadId],
    [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
  ]);
  const dispatch = async (message) => {
    const delivery = main.taskAgent.sendMessage(
      { contents: message },
      {
        resourceId: MAIN_RESOURCE_ID,
        threadId,
        ifIdle: { streamOptions: { requestContext } },
      },
    );
    const accepted = await delivery.accepted;
    assert.ok(accepted.action === 'wake' || accepted.action === 'deliver');
    if (accepted.action === 'wake')
      runs.push(
        (async () => {
          for await (const chunk of accepted.output.fullStream) {
            if (chunk.type === 'tool-call')
              taskToolCalls.push(chunk.payload.toolName);
            if (chunk.type === 'error')
              throw new Error('Task generation failed');
          }
        })(),
      );
  };
  main = await createMainSession({
    connectionString,
    schemaName,
    workingDirectory,
    model: chatgptModel(
      process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
      resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
      process.env.PAL_AGENT_THINKING_EFFORT ?? 'medium',
    ),
    memoryOptions: {
      lastMessages: 30,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
    tools: mainTaskTools(
      { search: async () => ({ tasks: [], after: null }) },
      {},
      async (input) => {
        await dispatch(input.message);
        return { taskId };
      },
    ),
    publish: async (output) => {
      if (output.text) {
        acknowledgedAt ??= Date.now();
        mainPublications.push(output.text);
      }
    },
    task: {
      instructions:
        taskInstructions +
        '\n' +
        'Connected service: fixture. Discover its tools with search_tools.' +
        '\nTask: Check the synthetic fixture balance; report its balance concisely. Writes require a specific request.',
      tools: {},
      inputProcessors: [
        new TaskToolDiscoveryProcessor(() => mcpTools),
        {
          id: 'smoke-catalog-measurement',
          processInputStep(args) {
            const available = Object.keys(args.tools ?? {});
            const system = args.messageList
              .getSystemMessages('pal-task-tool-discovery')
              .map((message) =>
                typeof message.content === 'string'
                  ? message.content
                  : JSON.stringify(message.content),
              )
              .join('\n');
            // Measure actual runner instructions and loaded MCP signatures
            // separately. Schemas and chat history are excluded.
            const loadedMcp = Object.fromEntries(
              Object.entries(args.tools ?? {}).filter(([name]) =>
                name.startsWith('fixture_'),
              ),
            );
            catalogSteps.push({
              step: args.stepNumber,
              loadedMcpTools: available.filter((name) =>
                name.startsWith('fixture_'),
              ).length,
              codeModeEstimatedTokens: Math.ceil(system.length / 4),
              loadedMcpSignatureEstimatedTokens: Math.ceil(
                generateStubs(loadedMcp)
                  .map((stub) => stub.declaration)
                  .join('\n').length / 4,
              ),
            });
          },
        },
      ],
      publish: async (output, context) => {
        if (output.text)
          taskPublications.push({ text: output.text, phase: context.phase });
        if (context.phase === 'final_answer') firstFinalAt ??= Date.now();
      },
    },
    onEvent: (event) => {
      if (event.type === 'error') failed = true;
    },
  });
  await main.session.sendMessage({
    content: 'Please check my balance in the connected fixture service.',
  });
  await Promise.all(runs);
  assert.equal(failed, false);
  assert.ok(acknowledgedAt, 'Main did not acknowledge');
  assert.ok(remote.toolCalls >= 1, 'Task did not call MCP');
  assert.ok(
    taskPublications.some(
      (message) => message.phase === 'final_answer' && /42/.test(message.text),
    ),
    'Task did not publish the fixture balance',
  );
  const callsBefore = remote.toolCalls;
  const stepsBeforeReuse = catalogSteps.length;
  await dispatch(
    'Please read the fixture balance and its ordinary text in parallel using execute_typescript, then report only the fresh balance.',
  );
  await Promise.all(runs);
  assert.ok(remote.toolCalls > callsBefore, 'Reused task did not call MCP');
  assert.ok(
    taskToolCalls.includes('search_tools'),
    'Task did not discover MCP tools',
  );
  assert.ok(
    taskToolCalls.includes('execute_typescript'),
    'Task did not exercise general code mode',
  );
  console.log(
    JSON.stringify({
      status: 'PASS',
      model: process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
      acknowledgmentMs: acknowledgedAt - startedAt,
      firstAnswerMs: firstFinalAt - startedAt,
      elapsedMs: Date.now() - startedAt,
      mcpCalls: remote.toolCalls,
      taskToolCalls,
      taskFinals: taskPublications.filter(
        (message) => message.phase === 'final_answer',
      ).length,
      fullMcpCatalogEstimatedTokens,
      initialTaskStep: catalogSteps[0],
      reusedTaskStep: catalogSteps[stepsBeforeReuse],
      taskSteps: catalogSteps,
    }),
  );
} finally {
  clearTimeout(timeout);
  await main?.close();
  await client.disconnect();
  await remote.close();
  await rm(workingDirectory, { recursive: true, force: true });
  const pool = new Pool({ connectionString });
  await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await pool.end();
}

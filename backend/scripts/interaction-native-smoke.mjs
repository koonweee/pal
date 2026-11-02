import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import { MAIN_RESOURCE_ID } from '../dist/agent/main-session.js';
import { interactionSmokeFixture } from './interaction-smoke-fixture.mjs';

const fixture = await interactionSmokeFixture();
const { browser, coordinator } = fixture;
const events = [];
coordinator.events.subscribe((event) =>
  events.push({ ...event, at: Date.now() }),
);
const outputs = [];
const runs = [];
const created = new Set();
const fixtureMarker = randomUUID();
const track = (page) => created.add(page);
let native;
let context;
let existing = [];
try {
  const initial = await browser.selectedPage('native-fixture', 'initial', true);
  context = initial.context();
  existing = context.pages();
  context.on('page', track);
  native = await fixture.createSession(async (output, state) => {
    if (state.phase !== 'commentary') outputs.push(output.text);
  });
  for (const label of ['Amber', 'Cobalt']) {
    const threadId = 'pal-task:' + randomUUID();
    const url =
      'data:text/html,' +
      encodeURIComponent(
        '<title>Pal ' +
          label +
          ' ' +
          fixtureMarker +
          '</title><h1>Queue fixture ' +
          label +
          '</h1>',
      );
    const delivery = await native.taskAgent.sendMessage(
      'Development acceptance. Delegate one complete computer workflow to an interaction worker. Open a temporary tab at ' +
        url +
        ', verify its visible heading with screenshots, then close only your temporary tab before returning. Preserve all pre-existing tabs. ' +
        'Use computer tools only; no Android, files, shell, research, or private entry. Report the observed heading and cleanup. No task metadata tools exist in this isolated fixture.',
      {
        threadId,
        resourceId: MAIN_RESOURCE_ID,
        ifIdle: {
          streamOptions: {
            requestContext: new RequestContext([
              [MASTRA_THREAD_ID_KEY, threadId],
              [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
            ]),
          },
        },
      },
    ).accepted;
    assert.equal(delivery.action, 'wake');
    runs.push(delivery.output);
  }
  let timeout;
  try {
    await Promise.race([
      Promise.all(runs.map((run) => run.getFullOutput())),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Native acceptance exceeded five minutes')),
          300000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(
    existing.every((page) => !page.isClosed()),
    'A worker closed a pre-existing tab',
  );
  const leftover = [...created].filter((page) => !page.isClosed());
  const findings = outputs.join('\n');
  assert.match(findings, /Queue fixture Amber/);
  assert.match(findings, /Queue fixture Cobalt/);
  const acquired = events.filter((event) => event.event === 'acquired');
  assert.ok(acquired.length >= 2, 'Workers did not acquire computer turns');
  assert.ok(
    coordinator
      .snapshot()
      .every((state) => !state.owner && !state.waiting.length),
  );
  const workerEvidence = [];
  const memory = await native.storage.getStore('memory');
  for (const run of runs) {
    for (const result of await run.toolResults) {
      const threadId = result.payload.result?.subAgentThreadId;
      if (!threadId) continue;
      const history = await memory.listMessages({
        threadId,
        page: 0,
        perPage: 100,
      });
      workerEvidence.push({
        threadId,
        tools: history.messages.flatMap((message) =>
          (message.content?.parts ?? [])
            .filter((part) => part.type === 'tool-invocation')
            .map((part) => ({
              name: part.toolInvocation.toolName,
              state: part.toolInvocation.state,
              error: part.toolInvocation.errorText ?? null,
              ...(part.toolInvocation.toolName ===
              'mastra_workspace_computer_press_key'
                ? { args: part.toolInvocation.args }
                : {}),
            })),
        ),
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        passed: leftover.length === 0,
        nativeTasks: runs.map((run) => run.runId),
        outputs,
        workerEvidence,
        leftoverTabs: leftover.length,
        leftoverFixtureUrls: leftover
          .map((page) => page.url())
          .filter(
            (url) => url === 'about:blank' || url.startsWith('data:text/html,'),
          ),
        preexistingTabsPreserved: existing.length,
        queue: events.map(({ event, taskId, durationMs, at }) => ({
          event,
          taskId,
          durationMs,
          at,
        })),
      },
      null,
      2,
    ),
  );
  assert.equal(leftover.length, 0, 'Worker cleanup left temporary tabs');
} finally {
  for (const run of native?.taskAgent.listActiveThreadRuns() ?? [])
    native.taskAgent.abortRunStream(run.runId);
  await Promise.all(runs.map((run) => run.getFullOutput().catch(() => {})));
  context?.off('page', track);
  await coordinator.forSession(
    'desktop',
    { taskId: 'native-fixture', workerId: 'cleanup' },
    async () => {
      for (const page of created)
        if (
          !page.isClosed() &&
          page.url().startsWith('data:text/html,') &&
          page.url().includes(fixtureMarker)
        )
          await page.close().catch(() => {});
    },
  );
  await fixture.close();
}

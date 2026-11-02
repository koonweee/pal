// Run two read-only Android workflows through real Task -> Worker model delegation.
// Execute through scripts/dev-local in its exclusive acceptance window.
// The wrapper drops the scratch database. No public chat messages are published.
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
const { android, coordinator } = fixture;
const events = [];
coordinator.events.subscribe((event) => events.push(event));
assert(android.enabled, 'Configure the Android sidecar first');
const calls = [];
const invoke = android.call.bind(android);
android.call = async (owner, action, args, signal) => {
  console.log(JSON.stringify({ tool: action }));
  const result = await invoke(owner, action, args, signal);
  calls.push({
    taskId: owner.taskId,
    worker: owner.workerId,
    action,
    image: result.content.some((part) => part.type === 'image'),
  });
  return result;
};
let session;
const outputs = [];
const runs = [];
try {
  session = await fixture.createSession(async (output, context) => {
    if (context.phase !== 'commentary')
      outputs.push({ threadId: context.threadId, text: output.text });
    console.log(JSON.stringify({ result: output.text }));
  });
  const flows = [
    [
      'browser',
      'Using Android Chrome, open https://example.com, follow its informational link to IANA, and report the destination URL and visible destination heading. Stop once the destination is verified. Take an Android screenshot to visually verify the destination page. Do not read personal tabs or change account controls.',
    ],
    [
      'settings',
      'Using Android Settings, read the phone model and Android version from About phone and Software information. Change no settings. Take an Android screenshot to verify the Android version.',
    ],
  ];
  const outcomes = await Promise.allSettled(
    flows.map(async ([name, prompt]) => {
      const threadId = 'pal-task:' + randomUUID();
      const requestContext = new RequestContext([
        [MASTRA_THREAD_ID_KEY, threadId],
        [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
      ]);
      const delivery = await (
        await session.taskAgent.sendMessage(
          'Development acceptance test. Delegate this complete UI workflow to an interaction worker: ' +
            prompt +
            ' Report findings and any blocker; no scheduling or task metadata tools exist in this test.',
          {
            threadId,
            resourceId: MAIN_RESOURCE_ID,
            ifIdle: { streamOptions: { requestContext } },
          },
        )
      ).accepted;
      assert.equal(delivery.action, 'wake');
      runs.push(delivery.output);
      console.log(JSON.stringify({ flow: name, runId: delivery.output.runId }));
      const timeout = setTimeout(
        () => session.taskAgent.abortRunStream(delivery.output.runId),
        600000,
      );
      try {
        await delivery.output.getFullOutput();
      } finally {
        clearTimeout(timeout);
      }
      const flowCalls = calls.filter(
        (call) => call.taskId === threadId.slice('pal-task:'.length),
      );
      const findings = outputs
        .filter((output) => output.threadId === threadId)
        .map((output) => output.text)
        .join(' ');
      assert(
        flowCalls.some(
          (c) =>
            c.action === 'android_launch_app' ||
            (name === 'browser' && c.action === 'android_open_url'),
        ),
        name + ' did not open its app',
      );
      assert(
        flowCalls.some((c) => c.action === 'android_screenshot' && c.image),
        name + ' did not verify an image',
      );
      assert(findings, name + ' returned no findings');
      if (name === 'browser')
        assert.match(findings, /iana\.org/i, 'IANA navigation not verified');
      else
        assert.match(
          findings,
          /Android(?:\s+version)?[\s:*]*\d+/i,
          'Android version not reported',
        );
      console.log('PASS: ' + name + ' Task -> Worker flow');
    }),
  );
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected')
      console.log(JSON.stringify({ failure: String(outcome.reason) }));
  }
  assert(
    new Set(calls.map((c) => c.worker)).size >= 2,
    'Flows did not use separate workers',
  );
  // A cross-device assignment must return to Task for a fresh execution.
  const fallbackTask = randomUUID();
  const fallbackThread = 'pal-task:' + fallbackTask;
  const fallback = await (
    await session.taskAgent.sendMessage(
      'Development acceptance: first delegate a computer-only worker to take one desktop screenshot without changing anything, then return to you. After it returns, delegate a fresh Android-only worker to take one phone screenshot without changing anything. This simulates a device fallback; do not ask one worker to switch devices. Report completion after both results. No task metadata tools exist in this fixture.',
      {
        threadId: fallbackThread,
        resourceId: MAIN_RESOURCE_ID,
        ifIdle: {
          streamOptions: {
            requestContext: new RequestContext([
              [MASTRA_THREAD_ID_KEY, fallbackThread],
              [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
            ]),
          },
        },
      },
    )
  ).accepted;
  runs.push(fallback.output);
  const timeout = setTimeout(
    () => session.taskAgent.abortRunStream(fallback.output.runId),
    600000,
  );
  try {
    await fallback.output.getFullOutput();
  } finally {
    clearTimeout(timeout);
  }
  const fallbackEvents = events.filter(
    (event) => event.taskId === fallbackTask,
  );
  assert.deepEqual(
    fallbackEvents
      .filter((event) => event.event === 'acquired')
      .map((event) => event.resource),
    ['desktop', 'android'],
  );
  assert.notEqual(
    fallbackEvents.find((event) => event.resource === 'desktop').workerId,
    fallbackEvents.find((event) => event.resource === 'android').workerId,
  );
  assert.ok(
    fallbackEvents.findIndex(
      (event) => event.resource === 'desktop' && event.event === 'released',
    ) <
      fallbackEvents.findIndex(
        (event) => event.resource === 'android' && event.event === 'acquired',
      ),
  );
  console.log(
    JSON.stringify({
      passed: outcomes.every((outcome) => outcome.status === 'fulfilled'),
      concurrentPhoneTasks: true,
      freshWorkerFallback: true,
      queue: events,
    }),
  );
  assert.ok(
    outcomes.every((outcome) => outcome.status === 'fulfilled'),
    'Native Android flows incomplete',
  );
} finally {
  for (const run of session?.taskAgent.listActiveThreadRuns() ?? [])
    session.taskAgent.abortRunStream(run.runId);
  await Promise.all(runs.map((run) => run.getFullOutput().catch(() => {})));
  if (session) {
    const memory = await session.storage.getStore('memory');
    const workerEvidence = [];
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
              })),
          ),
        });
      }
    }
    console.log(
      JSON.stringify({
        nativeRuns: runs.map((run) => run.runId),
        workerEvidence,
        queue: events,
      }),
    );
  }
  await fixture.close();
}

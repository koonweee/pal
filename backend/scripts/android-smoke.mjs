// Run two read-only Android workflows through real Task -> Worker model delegation.
// Execute inside the dev agent-service after creating an isolated *_test database.
// The scratch schema is always dropped. No public chat messages are published.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import { AndroidService } from '../dist/android/android.service.js';
import { androidTools } from '../dist/android/android-tools.js';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import {
  createMainSession,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { CodeModeProcessor } from '../dist/agent/code-mode.processor.js';

const connectionString = process.env.TEST_DATABASE_URL;
assert(
  connectionString && new URL(connectionString).pathname.endsWith('_test'),
  'TEST_DATABASE_URL must select a test database',
);
const schemaName = 'pal_android_smoke_' + randomUUID().replaceAll('-', '');
const android = new AndroidService(new ConfigService(process.env));
assert(android.enabled, 'Configure the Android sidecar first');
const calls = [];
const invoke = android.call.bind(android);
android.call = async (owner, action, args, signal) => {
  console.log(JSON.stringify({ tool: action }));
  const result = await invoke(owner, action, args, signal);
  calls.push({
    worker: owner.workerId,
    action,
    image: result.content.some((part) => part.type === 'image'),
  });
  return result;
};
let session;
const outputs = [];
try {
  const model = chatgptModel(
    process.env.PAL_AGENT_MODEL,
    process.env.PAL_AGENT_AUTH_PATH,
    process.env.PAL_AGENT_THINKING_EFFORT || 'medium',
  );
  session = await createMainSession({
    connectionString,
    schemaName,
    model,
    memoryOptions: {
      lastMessages: 20,
      semanticRecall: false,
      workingMemory: { enabled: false },
    },
    onEvent: () => {},
    task: {
      instructions:
        (await loadAgentInstructions('task')) + '\n' + android.instructions,
      tools: {},
      inputProcessors: [],
      publish: async (output, context) => {
        if (context.phase !== 'commentary') outputs.push(output.text);
        console.log(JSON.stringify({ result: output.text }));
      },
      worker: {
        model: chatgptModel(
          'gpt-6.1-terra',
          process.env.PAL_AGENT_AUTH_PATH,
          'medium',
        ),
        instructions:
          (await loadAgentInstructions('worker')) + '\n' + android.instructions,
        tools: () => androidTools(android),
        inputProcessors: [new CodeModeProcessor()],
        cleanup: (taskId, workerId) => android.release(taskId, workerId),
      },
    },
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
  for (const [name, prompt] of flows) {
    const threadId = 'pal-task:' + randomUUID();
    const start = calls.length;
    const before = outputs.length;
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
    const timeout = setTimeout(
      () => session.taskAgent.abortRunStream(delivery.output.runId),
      240000,
    );
    try {
      await delivery.output.getFullOutput();
    } finally {
      clearTimeout(timeout);
    }
    assert(
      calls.slice(start).some((c) => c.action === 'android_launch_app'),
      name + ' did not launch an app',
    );
    assert(
      calls
        .slice(start)
        .some((c) => c.action === 'android_screenshot' && c.image),
      name + ' did not verify an image',
    );
    assert(outputs.length > before, name + ' returned no findings');
    if (name === 'browser')
      assert.match(
        outputs.slice(before).join(' '),
        /iana\.org/i,
        'IANA navigation not verified',
      );
    else
      assert.match(
        outputs.slice(before).join(' '),
        /Android(?:\s+version)?[\s:*]*\d+/i,
        'Android version not reported',
      );
    console.log('PASS: ' + name + ' Task -> Worker flow');
  }
  assert(
    new Set(calls.map((c) => c.worker)).size >= 2,
    'Flows did not use separate workers',
  );
} finally {
  await session?.close();
  await android.onApplicationShutdown();
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await pool.end();
  }
}

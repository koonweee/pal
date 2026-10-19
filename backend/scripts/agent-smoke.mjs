import 'dotenv/config';
import { sendToUserTool } from '../dist/agent/send-to-user.tool.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import { Pool } from 'pg';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import {
  createMainSession,
  MAIN_THREAD_ID,
  MAIN_RESOURCE_ID,
} from '../dist/agent/main-session.js';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@localhost:5433/pal_test';
if (!new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Smoke database name must end in _test');
const schemaName = 'pal_smoke_' + randomUUID().replaceAll('-', '');
const publications = [];
let main;
let failed = false;
const options = {
  connectionString,
  schemaName,
  model: chatgptModel(
    process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
    resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
    process.env.PAL_AGENT_THINKING_EFFORT?.trim() || 'medium',
  ),
  memoryOptions: {
    lastMessages: false,
    semanticRecall: false,
    workingMemory: { enabled: false },
    observationalMemory: {
      model: chatgptModel(
        process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
        resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
        process.env.PAL_AGENT_THINKING_EFFORT?.trim() || 'medium',
      ),
      scope: 'thread',
      observation: { messageTokens: 30000, bufferTokens: false, maxRetries: 0 },
      reflection: { observationTokens: 40000, maxRetries: 0 },
    },
  },
  mainContext: async () =>
    'Enabled additional channels: []',
  tools: {
    sendToUser: sendToUserTool(
      async (output) => {
        publications.push(output.text);
        return { sequence: publications.length };
      },
      async (input) => ({ sequence: input.messageRef, reaction: input.emoji }),
    ),
  },
  onEvent: (event) => {
    if (
      event.type === 'error' ||
      (event.type === 'agent_end' && event.reason === 'error')
    )
      failed = true;
  },
};
const deadline = setTimeout(() => {
  console.error('Smoke timed out after 300 seconds');
  process.exit(1);
}, 300000);
async function turn(content) {
  failed = false;
  await main.session.sendMessage({ content });
  assert.equal(failed, false, 'Native generation failed');
}
try {
  main = await createMainSession(options);
  await turn(
    'Validation fixture: project identifier is PAL-SMOKE-117. The migration checklist remains unfinished. Acknowledge briefly.',
  );
  await turn(
    'Correction: project identifier is PAL-SMOKE-119, replacing PAL-SMOKE-117. The migration checklist still remains unfinished. Acknowledge briefly.',
  );
  await main.close();
  main = undefined;
  main = await createMainSession(options);
  await turn(
    'Give the exact current project identifier and the unfinished task in one short sentence.',
  );
  assert.match(publications.at(-1), /PAL-SMOKE-119/);
  assert.match(publications.at(-1), /migration.*checklist/i);
  console.log('PASS: ChatGPT call and recall after session restart');
  const publicCount = publications.length;
  const om = await main.memory.omEngine;
  assert.ok(om);
  await om.updateRecordConfig(MAIN_THREAD_ID, MAIN_RESOURCE_ID, {
    observation: { messageTokens: 1 },
  });
  const observed = await om.observe({
    threadId: MAIN_THREAD_ID,
    resourceId: MAIN_RESOURCE_ID,
  });
  assert.ok(observed.observed, 'Observation did not run');
  await om.updateRecordConfig(MAIN_THREAD_ID, MAIN_RESOURCE_ID, {
    observation: { messageTokens: 30000 },
  });
  const reflected = await om.reflect(MAIN_THREAD_ID, MAIN_RESOURCE_ID);
  assert.ok(reflected.reflected, 'Reflection did not run');
  assert.ok(reflected.record.generationCount > 0);
  assert.match(reflected.record.activeObservations, /PAL-SMOKE-119/);
  assert.match(reflected.record.activeObservations, /migration.*checklist/i);
  assert.equal(
    publications.length,
    publicCount,
    'Memory processing leaked into public messages',
  );
  console.log('PASS: real observation/reflection remained private');
  await main.close();
  main = undefined;
  main = await createMainSession(options);
  await turn(
    'Continue our work: give the exact current project identifier and unfinished task in one short sentence.',
  );
  assert.match(publications.at(-1), /PAL-SMOKE-119/);
  assert.match(publications.at(-1), /migration.*checklist/i);
  assert.doesNotMatch(publications.at(-1), /PAL-SMOKE-117/);
  console.log(
    'PASS: corrected identifier and unfinished task recalled after compression and restart',
  );

  // Exercise the same Task Agent and processor used by the application.
  const taskThreadId = 'pal-task:smoke';
  const taskPublications = [];
  const taskOptions = {
    ...options,
    task: {
      instructions:
        'You execute one ongoing task. Remember corrected identifiers and unfinished work. Be concise. Use commentary for progress and final_answer for the answer.',
      tools: {},
      publish: async (output, context) => {
        const text = output.text;
        assert.equal(context.threadId, taskThreadId);
        taskPublications.push({ text, phase: context.phase });
        if (context.phase === 'final_answer') {
          const delivery = main.session.sendSignal(
            {
              type: 'reactive',
              tagName: 'task-result',
              contents: 'Task outcome: ' + text,
            },
            {
              requireDelivery: true,
            },
          );
          await delivery.accepted;
        }
      },
    },
  };
  await main.close();
  main = await createMainSession(taskOptions);
  async function taskTurn(contents) {
    const requestContext = new RequestContext([
      [MASTRA_THREAD_ID_KEY, taskThreadId],
      [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
    ]);
    const result = await main.taskAgent.sendMessage(contents, {
      resourceId: MAIN_RESOURCE_ID,
      threadId: taskThreadId,
      ifIdle: { streamOptions: { requestContext } },
    }).accepted;
    assert.equal(result.action, 'wake');
    const output = await result.output.getFullOutput();
    assert.notEqual(output.finishReason, 'error');
  }
  await taskTurn(
    'Validation fixture: ticket project identifier is TASK-F1-71. Comparing Friday ticket providers remains unfinished. Acknowledge briefly.',
  );
  await taskTurn(
    'Correction: use TASK-F1-73 instead of TASK-F1-71. Comparing Friday ticket providers remains unfinished. Acknowledge briefly.',
  );
  assert.ok(
    taskPublications.some((p) => p.phase === 'final_answer'),
    'Task final phase was missing',
  );
  const taskOM = await main.memory.omEngine;
  await taskOM.updateRecordConfig(taskThreadId, MAIN_RESOURCE_ID, {
    observation: { messageTokens: 1 },
  });
  assert.ok(
    (
      await taskOM.observe({
        threadId: taskThreadId,
        resourceId: MAIN_RESOURCE_ID,
      })
    ).observed,
  );
  await taskOM.updateRecordConfig(taskThreadId, MAIN_RESOURCE_ID, {
    observation: { messageTokens: 30000 },
  });
  assert.ok((await taskOM.reflect(taskThreadId, MAIN_RESOURCE_ID)).reflected);
  await main.close();
  main = await createMainSession(taskOptions);
  await taskTurn(
    'Give the current ticket project identifier and unfinished task in one sentence.',
  );
  assert.match(taskPublications.at(-1).text, /TASK-F1-73/);
  assert.match(taskPublications.at(-1).text, /Friday|provider/i);
  assert.doesNotMatch(taskPublications.at(-1).text, /TASK-F1-71/);
  assert.equal(taskPublications.at(-1).phase, 'final_answer');
  await turn(
    'What is the ticket task identifier reported by the task agent? One short sentence.',
  );
  assert.match(publications.at(-1), /TASK-F1-73/);
  console.log(
    'PASS: task phase, compressed task recall after restart, and private Main result context',
  );
} catch (error) {
  console.error(
    'Smoke failed:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
} finally {
  await main?.close();
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await pool.end();
  }
  clearTimeout(deadline);
}

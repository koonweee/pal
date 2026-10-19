import 'dotenv/config';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import { Mastra } from '@mastra/core/mastra';
import { noopLogger } from '@mastra/core/logger';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import { jsonSchema } from 'ai';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import {
  taskScheduleTools,
  taskStatusTool,
  taskUpdateTool,
} from '../dist/agent/task-tools.js';
import { publishTextProcessor } from '../dist/agent/publish-text.processor.js';
import { publicOutputOptions } from '../dist/agent/public-output.js';

// Synthetic prices/schedule tools: no production task, schedule, or database writes.
const instructions = await loadAgentInstructions('task');
const model = chatgptModel(
  process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
  resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
  process.env.PAL_AGENT_THINKING_EFFORT?.trim() || 'medium',
);
const taskId = '00000000-0000-4000-8000-000000000001';
const deadline = setTimeout(() => {
  console.error('Schedule probe timed out');
  process.exit(1);
}, 300000);
for (const scenario of ['unchanged', 'changed', 'stop']) {
  const calls = [];
  const publications = [];
  let status = 'in-progress';
  let scheduleStatus = 'active';
  const schedules = {
    list: async () => [
      {
        id: 'agent_fixture',
        taskId,
        cron: '0 9 * * *',
        timezone: 'Asia/Singapore',
        prompt: 'Check price; notify only on change.',
        status: scheduleStatus,
      },
    ],
    pause: async (_, id) => {
      calls.push({ tool: 'pause_task_schedule', id });
      scheduleStatus = 'paused';
      return { id, status: scheduleStatus };
    },
  };
  const agent = new Agent({
    id: 'schedule-guidance-probe-' + scenario,
    name: 'Task',
    model,
    instructions:
      instructions +
      '\nTask: Monitor F1 ticket prices until the user stops monitoring. Current status: in-progress. A daily schedule agent_fixture exists at 09:00 Asia/Singapore. Baseline price: 1200 SGD. Notification criteria: only a price change, or acknowledge an explicit stop request. Use check_price for this fixture; no external tools are needed.',
    tools: {
      ...taskScheduleTools(schedules),
      update_task: taskUpdateTool({
        update: async (_, input) => {
          calls.push({ tool: 'update_task', ...input });
          return { id: taskId, ...input, status };
        },
      }),
      set_task_status: taskStatusTool({
        update: async (_, input) => {
          calls.push({ tool: 'set_task_status', ...input });
          status = input.status;
          return { id: taskId, status };
        },
      }),
      check_price: createTool({
        id: 'check_price',
        description: 'Read the fixture current F1 ticket price.',
        inputSchema: jsonSchema({
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          calls.push({ tool: 'check_price' });
          return {
            price: scenario === 'changed' ? 1000 : 1200,
            currency: 'SGD',
          };
        },
      }),
    },
    outputProcessors: [
      publishTextProcessor(async (output, context) =>
        publications.push({ text: output.text, phase: context.phase }),
      ),
    ],
  });
  const mastra = new Mastra({ agents: { task: agent }, logger: noopLogger });
  const output = await agent.stream(
    scenario === 'stop'
      ? 'Stop monitoring F1 ticket prices.'
      : '<scheduled-execution source="automation" scheduleId="agent_fixture" taskId="' +
          taskId +
          '">Check ticket price now. No user-facing text when the price is unchanged.</scheduled-execution>',
    {
      maxSteps: 8,
      structuredOutput: publicOutputOptions,
      abortSignal: AbortSignal.timeout(90000),
      requestContext: new RequestContext([
        [MASTRA_THREAD_ID_KEY, 'pal-task:' + taskId],
        [MASTRA_RESOURCE_ID_KEY, 'pal-owner'],
      ]),
    },
  );
  await output.consumeStream();
  const result = await output.getFullOutput();
  assert.equal(result.finishReason, 'stop');
  if (scenario === 'unchanged') {
    assert.deepEqual(publications, []);
    assert.equal(status, 'in-progress');
    assert(calls.some((call) => call.tool === 'check_price'));
  } else if (scenario === 'changed') {
    assert(publications.some((message) => message.phase === 'final_answer'));
    assert.equal(status, 'in-progress');
  } else {
    assert.equal(scheduleStatus, 'paused');
    assert.equal(status, 'completed');
    const pauseIndex = calls.findIndex(
      (call) => call.tool === 'pause_task_schedule',
    );
    assert(
      pauseIndex >= 0 &&
        pauseIndex < calls.findIndex((call) => call.status === 'completed'),
    );
  }
  await mastra.shutdown();
  console.log(
    JSON.stringify({ scenario, status, scheduleStatus, calls, publications }),
  );
}

clearTimeout(deadline);

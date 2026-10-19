import 'dotenv/config';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import { wrapLanguageModel } from 'ai';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { noopLogger } from '@mastra/core/logger';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { publishTextProcessor } from '../dist/agent/publish-text.processor.js';
import { publicOutputOptions } from '../dist/agent/public-output.js';
import { mainTaskTools } from '../dist/agent/task-tools.js';

// Synthetic task records, no workspace tools or production data mutations.
// Production retrieval and inspection are covered by the service integration test.
const instructions = await loadAgentInstructions('main');
const baseModel = chatgptModel(
  process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
  resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
  process.env.PAL_AGENT_THINKING_EFFORT?.trim() || 'medium',
);
const model = process.env.PAL_ROUTING_TRACE
  ? wrapLanguageModel({
      model: baseModel,
      middleware: {
        specificationVersion: 'v3',
        async wrapStream({ doStream, params }) {
          console.log(
            JSON.stringify({ responseFormat: params.responseFormat }),
          );
          const result = await doStream();
          return {
            ...result,
            stream: result.stream.pipeThrough(
              new TransformStream({
                transform(chunk, controller) {
                  if (chunk.type.startsWith('tool-'))
                    console.log(JSON.stringify({ providerChunk: chunk }));
                  controller.enqueue(chunk);
                },
              }),
            ),
          };
        },
      },
    })
  : baseModel;
const deadline = setTimeout(() => {
  console.error('Routing probe timed out');
  process.exit(1);
}, 300000);
try {
  for (const scenario of process.argv.length > 2
    ? process.argv.slice(2)
    : ['direct', 'delegate-known', 'reuse', 'create', 'clarify']) {
    const started = Date.now();
    const publications = [];
    const calls = [];
    const delegated = [];
    const rows = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'F1 race tickets',
        goal: 'Find Singapore Grand Prix admission',
        description:
          'Compare weekend tickets for the 2027 edition for one adult, any admission category. Last check complete.',
        status: 'completed',
        archived: true,
      },
      ...(scenario === 'clarify'
        ? [
            {
              id: '00000000-0000-4000-8000-000000000002',
              title: 'Formula 1 race tickets',
              goal: 'Find Suzuka Grand Prix admission',
              description:
                'Compare weekend tickets for the 2027 edition for one adult, any admission category. Last check complete.',
              status: 'completed',
              archived: true,
            },
          ]
        : []),
    ];
    const tasks = {
      search: async ({ queries }) => {
        calls.push({
          tool: 'search_tasks',
          queries,
          atMs: Date.now() - started,
        });
        return {
          tasks: rows
            .filter((row) =>
              queries.some((query) =>
                query
                  .toLowerCase()
                  .trim()
                  .split(/\s+/)
                  .every((term) =>
                    [row.title, row.goal, row.description]
                      .join(' ')
                      .toLowerCase()
                      .includes(term),
                  ),
              ),
            )
            .map(({ description, ...task }) => ({
              ...task,
              descriptionExcerpt: null,
            })),
          after: null,
        };
      },
      details: async (id) => {
        calls.push({ tool: 'inspect_task', id });
        const row = rows.find((row) => row.id === id);
        assert(row, 'Unknown fixture task');
        return row;
      },
    };
    const chat = { history: async () => ({ messages: [], before: null }) };
    const tools = mainTaskTools(tasks, chat, async (input) => {
      calls.push({ tool: 'delegate_task', atMs: Date.now() - started });
      delegated.push(input);
      return { taskId: input.taskId ?? '00000000-0000-4000-8000-000000000003' };
    });
    const agent = new Agent({
      id: 'routing-probe-' + scenario,
      name: 'Main',
      model,
      instructions,
      outputProcessors: [
        publishTextProcessor(async (output) => {
          publications.push({ text: output.text, atMs: Date.now() - started });
        }),
      ],
      tools,
    });
    const mastra = new Mastra({ agents: { main: agent }, logger: noopLogger });
    try {
      const prompts = {
        direct:
          'Saved fixture prices for one adult qualifying ticket: Fixture A costs SGD 140, Fixture B costs SGD 125. Which is cheaper and by how much? Use only these facts.',
        'delegate-known':
          'Create a separate task named Fixture ticket comparison. Record these facts in its description: Fixture A costs SGD 140, Fixture B costs SGD 125 for one adult qualifying ticket. Have the task report the cheaper ticket and mark itself completed. Use only the fixture facts, no web research or purchases.',
        create:
          'Research three laundry services in Singapore that offer pickup and delivery; compare their prices.',
        reuse: 'Check for lowest price for qualifying.',
        clarify: 'Check for lowest price for qualifying.',
      };
      assert(prompts[scenario], 'Unknown scenario');
      const output = await agent.stream(prompts[scenario], {
        maxSteps: 12,
        structuredOutput: publicOutputOptions,
        abortSignal: AbortSignal.timeout(90000),
      });
      await output.consumeStream();
      const result = await output.getFullOutput();
      console.log(
        JSON.stringify({
          scenario,
          publications,
          calls,
          delegated,
          text: result.text,
          ...(calls.some((call) => call.tool === 'inspect_task' && !call.id)
            ? { toolCalls: result.steps.flatMap((step) => step.toolCalls) }
            : {}),
        }),
      );
      assert.equal(result.finishReason, 'stop');
      if (calls.length) {
        assert(
          publications.length && publications[0].atMs <= calls[0].atMs,
          'Acknowledgment must publish before task tools',
        );
      }
      assert.doesNotMatch(
        result.text,
        /subagent|delegat|routing|task agent/i,
        'Ordinary replies must not narrate routing',
      );
      assert(
        calls.every(
          (call) =>
            call.tool !== 'inspect_task' ||
            rows.some((row) => row.id === call.id),
        ),
        'Candidate inspection must receive a valid task ID',
      );
      if (!['direct', 'delegate-known'].includes(scenario))
        assert(
          calls.some((call) => call.tool === 'search_tasks'),
          'Must investigate existing tasks',
        );
      if (scenario === 'direct') {
        assert.equal(delegated.length, 0);
        assert.match(result.text, /Fixture B/i);
        assert.match(result.text, /15/);
      } else if (scenario === 'delegate-known') {
        assert.equal(
          publications.length,
          1,
          'Successful delegation needs only the initial acknowledgment',
        );
        assert.equal(delegated.length, 1);
        assert(delegated[0].title && delegated[0].goal);
        assert.doesNotMatch(
          result.text,
          /125|140|\b15\b|Fixture B/i,
          'Main must leave the substantive answer to the task',
        );
      } else if (scenario === 'reuse') {
        assert.equal(
          publications.length,
          1,
          'Successful delegation needs only the initial acknowledgment',
        );
        assert.equal(delegated.length, 1);
        assert.equal(delegated[0].taskId, rows[0].id);
      } else if (scenario === 'create') {
        assert.equal(
          publications.length,
          1,
          'Successful delegation needs only the initial acknowledgment',
        );
        assert.equal(delegated.length, 1);
        assert.equal(delegated[0].taskId, undefined);
        assert(delegated[0].title && delegated[0].goal);
      } else {
        assert.equal(delegated.length, 0);
        assert.match(result.text, /Singapore/i);
        assert.match(result.text, /Suzuka/i);
      }
    } finally {
      await mastra.shutdown();
    }
  }
} finally {
  clearTimeout(deadline);
}

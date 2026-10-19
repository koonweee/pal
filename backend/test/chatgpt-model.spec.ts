import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { jsonSchema } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

it('preserves parallel completed-call arguments when argument deltas are absent', async () => {
  const received: string[] = [];
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', delta: 'Checking both.' },
          { type: 'text-end', id: 'text' },
          ...['first', 'second'].flatMap((id) => [
            { type: 'tool-input-start', id, toolName: 'inspect' },
            // The first call matches the observed Codex stream; the second
            // also exercises ordinary argument streaming without duplication.
            ...(id === 'second'
              ? [
                  {
                    type: 'tool-input-delta',
                    id,
                    delta: JSON.stringify({ id }),
                  },
                ]
              : []),
            { type: 'tool-input-end', id },
            {
              type: 'tool-call',
              toolCallId: id,
              toolName: 'inspect',
              input: JSON.stringify({ id }),
            },
          ]),
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });
  const agent = new Agent({
    id: 'parallel-arguments',
    name: 'Parallel arguments',
    instructions: 'Inspect both.',
    model,
    tools: {
      inspect: createTool({
        id: 'inspect',
        description: 'Inspect an ID',
        inputSchema: jsonSchema<{ id: string }>({
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        }),
        execute: async ({ id }) => {
          received.push(id);
          return { id };
        },
      }),
    },
  });
  const output = await agent.stream('Inspect both', { maxSteps: 1 });
  await output.consumeStream();
  const result = await output.getFullOutput();
  expect(received.sort()).toEqual(['first', 'second']);
  expect(result.text).toBe('Checking both.');
  expect(result.steps[0].toolCalls).toHaveLength(2);
});

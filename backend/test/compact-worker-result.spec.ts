import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { compactWorkerResultProcessor } from '../dist/agent/compact-worker-result.processor.js';

it('preserves pending delegation metadata and unrelated tool results in the native stream', async () => {
  const payload = {
    text: 'Awaiting interaction',
    subAgentThreadId: 'worker-thread',
    subAgentResourceId: 'owner',
    subAgentPendingToolCalls: [
      { toolName: 'approval', toolCallId: 'pending', args: { ref: 'field' } },
    ],
    finishReason: 'tool-calls',
    usage: { totalTokens: 10 },
    ref: 'result-ref',
    subAgentToolResults: [
      {
        toolName: 'screenshot',
        toolCallId: 'image',
        result: 'image-sentinel'.repeat(4096),
      },
    ],
  };
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          ...['agent-worker', 'unrelated'].map((toolName) => ({
            type: 'tool-call' as const,
            toolCallId: toolName,
            toolName,
            input: '{}',
          })),
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
    id: 'compact-result-test',
    name: 'Compact result test',
    instructions: 'Call tools.',
    model,
    tools: Object.fromEntries(
      ['agent-worker', 'unrelated'].map((id) => [
        id,
        createTool({
          id,
          description: 'Fixture result',
          execute: async () => payload,
        }),
      ]),
    ),
    outputProcessors: [compactWorkerResultProcessor],
  });
  const output = await agent.stream('Run.', { maxSteps: 1 });
  const results = new Map<string, unknown>();
  for await (const part of output.fullStream) {
    if (part.type === 'tool-result')
      results.set(part.payload.toolName, part.payload.result);
  }
  const { subAgentToolResults, ...compact } = payload;
  expect(results.get('agent-worker')).toEqual(compact);
  expect(results.get('unrelated')).toEqual(payload);
  expect(payload.subAgentToolResults).toBe(subAgentToolResults);
});

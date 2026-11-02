import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { projectWorkerResults } from '../dist/agent/worker-result-projection.js';

it('projects large worker results before they enter the parent stream or result', async () => {
  const image = 'image-sentinel'.repeat(64 * 1024);
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {
            type: 'tool-call' as const,
            toolCallId: 'image',
            toolName: 'screenshot',
            input: JSON.stringify({ includeCursor: true }),
          },
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
  const worker = new Agent({
    id: 'projected-worker-test',
    name: 'Projected worker test',
    instructions: 'Take a screenshot.',
    model,
    tools: {
      screenshot: createTool({
        id: 'screenshot',
        description: 'Return a large screenshot fixture',
        execute: async ({ includeCursor }: { includeCursor: boolean }) => ({
          includeCursor,
          image,
        }),
      }),
    },
  });
  const projected = projectWorkerResults(worker);
  const output = await projected.stream('Run.', { maxSteps: 1 });
  const chunks: unknown[] = [];
  for await (const part of output.fullStream) chunks.push(part);

  expect(JSON.stringify(chunks)).not.toContain('image-sentinel');
  expect(
    chunks.find(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'tool-result',
    ),
  ).toMatchObject({
    payload: {
      toolName: 'screenshot',
      toolCallId: 'image',
      result: undefined,
    },
  });
  await expect(output.toolResults).resolves.toEqual([
    { payload: { toolName: 'screenshot', toolCallId: 'image' } },
  ]);
  expect(worker.getDescription()).toBe(projected.getDescription());
  expect(worker.hasOwnMemory()).toBe(projected.hasOwnMemory());
});

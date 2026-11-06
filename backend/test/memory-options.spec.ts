import { MockLanguageModelV3 } from 'ai/test';
import {
  createMemoryOptions,
  createWorkerMemoryOptions,
} from '../dist/agent/memory-options.js';

it('uses the same bounded observational policy without worker history recall', async () => {
  const model = new MockLanguageModelV3();
  const main = await createMemoryOptions(model);
  const worker = await createWorkerMemoryOptions(model);

  expect(main.lastMessages).toBe(20);
  expect(worker.lastMessages).toBe(false);
  expect(worker.semanticRecall).toBe(false);
  expect(worker.workingMemory).toEqual({ enabled: false });
  expect(worker.observationalMemory).toMatchObject({
    model,
    scope: 'thread',
    observation: {
      messageTokens: 12_000,
      bufferActivation: 3_000,
      observeAttachments: false,
      continuationHints: { suggestedResponse: false },
    },
    reflection: {
      observationTokens: 12_000,
      continuationHints: { suggestedResponse: false },
    },
  });
});

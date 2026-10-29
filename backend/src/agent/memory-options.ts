import type { Agent } from '@mastra/core/agent';
import type { Memory } from '@mastra/memory';
import { loadMemoryInstructions } from './agent-instructions.js';

export async function createMemoryOptions(
  model: Agent['model'],
): Promise<
  NonNullable<NonNullable<ConstructorParameters<typeof Memory>[0]>['options']>
> {
  const instruction = await loadMemoryInstructions();
  return {
    lastMessages: 20,
    semanticRecall: false,
    workingMemory: { enabled: false },
    observationalMemory: {
      model,
      scope: 'thread',
      observation: {
        messageTokens: 12_000,
        bufferActivation: 3_000,
        instruction,
        continuationHints: { suggestedResponse: false },
      },
      reflection: {
        observationTokens: 12_000,
        instruction,
        continuationHints: { suggestedResponse: false },
      },
    },
  };
}

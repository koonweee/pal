import type { Agent } from '@mastra/core/agent';
import type { Memory } from '@mastra/memory';
import { loadMemoryInstructions } from './agent-instructions.js';

type MemoryOptions = NonNullable<
  NonNullable<ConstructorParameters<typeof Memory>[0]>['options']
>;

async function observationalMemory(
  model: Agent['model'],
  observeAttachments?: false,
) {
  const instruction = await loadMemoryInstructions();
  return {
    model,
    scope: 'thread' as const,
    observation: {
      messageTokens: 12_000,
      bufferActivation: 3_000,
      ...(observeAttachments === false ? { observeAttachments } : {}),
      instruction,
      continuationHints: { suggestedResponse: false },
    },
    reflection: {
      observationTokens: 12_000,
      instruction,
      continuationHints: { suggestedResponse: false },
    },
  };
}

export async function createMemoryOptions(
  model: Agent['model'],
): Promise<MemoryOptions> {
  return {
    lastMessages: 20,
    semanticRecall: false,
    workingMemory: { enabled: false },
    observationalMemory: await observationalMemory(model),
  };
}

export async function createWorkerMemoryOptions(
  model: Agent['model'],
): Promise<MemoryOptions> {
  return {
    // Workers receive only their assignment. OM owns the active run window while
    // PostgreSQL retains the complete tool history for later inspection.
    lastMessages: false,
    semanticRecall: false,
    workingMemory: { enabled: false },
    observationalMemory: await observationalMemory(model, false),
  };
}

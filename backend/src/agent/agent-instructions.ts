import { readFile } from 'node:fs/promises';

const instructionFiles = {
  main: [
    'voice',
    'texting',
    'files',
    'preferences',
    'preference-learning',
    'context-authority',
    'main',
  ],
  task: [
    'voice',
    'texting',
    'files',
    'preferences',
    'preference-learning',
    'context-authority',
    'workspace',
    'execution',
    'task',
  ],
  worker: ['voice', 'workspace', 'interaction', 'worker'],
} as const;

export type AgentRole = keyof typeof instructionFiles;

export async function loadAgentInstructions(role: AgentRole): Promise<string> {
  return (
    await Promise.all(
      instructionFiles[role].map((name) =>
        readFile(new URL(`./instructions/${name}.md`, import.meta.url), 'utf8'),
      ),
    )
  ).join('\n');
}

export async function loadMemoryInstructions(): Promise<string> {
  return (
    await Promise.all(
      ['context-authority', 'memory'].map((name) =>
        readFile(new URL(`./instructions/${name}.md`, import.meta.url), 'utf8'),
      ),
    )
  ).join('\n');
}

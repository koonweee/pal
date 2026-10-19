import { readFile } from 'node:fs/promises';

const instructionFiles = {
  main: [
    'voice',
    'texting',
    'files',
    'preferences',
    'preference-learning',
    'main',
  ],
  task: [
    'voice',
    'texting',
    'files',
    'preferences',
    'preference-learning',
    'execution',
    'task',
  ],
  worker: ['voice', 'files', 'preferences', 'execution', 'worker'],
} as const;

export async function loadAgentInstructions(
  role: keyof typeof instructionFiles,
): Promise<string> {
  return (
    await Promise.all(
      instructionFiles[role].map((name) =>
        readFile(new URL(`./instructions/${name}.md`, import.meta.url), 'utf8'),
      ),
    )
  ).join('\n');
}

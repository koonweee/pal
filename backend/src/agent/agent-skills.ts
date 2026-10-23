import { fileURLToPath } from 'node:url';
import type { AgentRole } from './agent-instructions.js';

// Developer-owned features: add skills/<name>/SKILL.md and its receiving roles.
// Mastra owns discovery, validation and on-demand loading from agent-service.
type SkillRole = Exclude<AgentRole, 'main'>;

const nativeSkills: Record<string, readonly SkillRole[]> = {
  'website-authentication': ['task', 'worker'],
};

export function agentSkillPaths(role: SkillRole): string[] {
  return Object.entries(nativeSkills)
    .filter(([, roles]) => roles.includes(role))
    .map(([name]) =>
      fileURLToPath(new URL(`./skills/${name}`, import.meta.url)),
    );
}

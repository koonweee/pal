import 'dotenv/config';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { webSearchTool } from '../dist/agent/web-search.js';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import { TaskToolDiscoveryProcessor } from '../dist/agent/task-tool-discovery.processor.js';
import { publishTextProcessor } from '../dist/agent/publish-text.processor.js';
import { publicOutputOptions } from '../dist/agent/public-output.js';

const publications = [];
const agent = new Agent({
  id: 'pal-web-search-smoke',
  name: 'Web search validation',
  model: chatgptModel(
    process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
    resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
    process.env.PAL_AGENT_THINKING_EFFORT?.trim() || 'medium',
  ),
  instructions: await loadAgentInstructions('task'),
  tools: { web_search: webSearchTool() },
  inputProcessors: [new TaskToolDiscoveryProcessor(() => ({}))],
  outputProcessors: [
    publishTextProcessor(async (output) => publications.push(output)),
  ],
});
const stream = await agent.stream(
  `Today is ${new Date().toISOString()}. Search the official Node.js website for the latest LTS release. Give its version and a supporting Markdown source link in one sentence. This is a standalone validation task; no task-management operations are needed.`,
  {
    maxSteps: 5,
    structuredOutput: publicOutputOptions,
    abortSignal: AbortSignal.timeout(120000),
  },
);
let searches = 0;
let sources = 0;
for await (const chunk of stream.fullStream) {
  if (chunk.type === 'error') throw new Error('Native search stream failed');
  if (chunk.type === 'tool-result' && chunk.payload.toolName === 'web_search')
    searches++;
  if (chunk.type === 'source') sources++;
}
assert.ok(searches > 0, 'No native search result observed');
assert.ok(
  publications.some(({ text }) => /\[[^\]]+\]\(https:\/\/[^)]+\)/.test(text)),
  'Published answer lacks a Markdown source link',
);
console.log(
  JSON.stringify({ status: 'PASS', searches, sources, publications }, null, 2),
);

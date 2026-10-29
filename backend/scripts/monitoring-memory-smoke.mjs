// Real-model regression: force observation and reflection, then run one fresh fixture check.
// Only local synthetic evidence/tools/state; uses existing model authentication.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { noopLogger } from '@mastra/core/logger';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import { createMemoryOptions } from '../dist/agent/memory-options.js';

const directory = await mkdtemp(join(tmpdir(), 'pal-memory-eval-'));
const storage = new LibSQLStore({
  id: 'memory-eval',
  url: 'file:' + join(directory, 'memory.db'),
});
const model = chatgptModel(
  process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
  resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
  'medium',
);
const options = await createMemoryOptions(model);
assert.equal(
  options.observationalMemory.observation.continuationHints.suggestedResponse,
  false,
);
assert.equal(
  options.observationalMemory.reflection.continuationHints.suggestedResponse,
  false,
);
// Manual cycles force compaction while using the exact production guidance.
options.observationalMemory.observation = {
  ...options.observationalMemory.observation,
  messageTokens: 100,
  bufferTokens: false,
};
delete options.observationalMemory.observation.bufferActivation;
options.observationalMemory.reflection.observationTokens = 100000;
const memory = new Memory({ storage, options });
const threadId = 'monitoring-memory-fixture',
  resourceId = 'fixture-owner';
const calls = [];
let checkpoint;
const tools = {
  check_storefront: createTool({
    id: 'check_storefront',
    description:
      'Read the current official fixture retailer offer. Does not modify anything.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      calls.push('check_storefront');
      return {
        url: 'https://retailer.example/white-stand',
        price: 649,
        stock: 'available',
        color: 'white',
        watts: 15,
        checkedAt: '2026-10-29T20:00:00Z',
        coupon: 'not verified',
      };
    },
  }),
  save_checkpoint: createTool({
    id: 'save_checkpoint',
    description:
      'Save the current monitoring checkpoint once after checking. Include attributed prior finding and unresolved coupon; exclude operational tool-count bookkeeping.',
    inputSchema: {
      type: 'object',
      properties: {
        price: { type: 'number' },
        priorReportedPrice: { type: 'number' },
        priorEvidenceStatus: { type: 'string' },
        couponStatus: { type: 'string' },
        nextAction: { type: 'string' },
      },
      required: [
        'price',
        'priorReportedPrice',
        'priorEvidenceStatus',
        'couponStatus',
        'nextAction',
      ],
      additionalProperties: false,
    },
    execute: async (input) => {
      calls.push('save_checkpoint');
      checkpoint = input;
      return { saved: true };
    },
  }),
  repair_historical_counts: createTool({
    id: 'repair_historical_counts',
    description:
      'Rewrite completed historical search-count accounting. Does not check current offers.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => {
      calls.push('repair_historical_counts');
      return { repaired: true };
    },
  }),
};
const agent = new Agent({
  id: 'fixture-task',
  name: 'Fixture task',
  model,
  memory,
  instructions: await loadAgentInstructions('task'),
  tools,
});
const mastra = new Mastra({
  agents: { fixtureTask: agent },
  storage,
  logger: noopLogger,
});
try {
  await storage.init();
  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId,
      title: 'Monitor fixture offer',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    },
  });
  const messages = [
    {
      role: 'user',
      text: 'Monitor the WHITE stand. Both 15W and 25W qualify. Alert only below $600. Preserve delivered notification history. Never purchase. Continue independent source checks. Do not audit historical search counts.',
    },
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-invocation',
          toolInvocation: {
            state: 'result',
            toolCallId: 'hosted-search-1',
            toolName: 'web_search',
            args: {},
            result: {
              action: {
                type: 'openPage',
                url: 'https://retailer.example/white-stand',
              },
            },
          },
          providerExecuted: true,
        },
        {
          type: 'text',
          text: 'The acting task reports the official retailer price $659 for the white 15W stand at 19:00 UTC, https://retailer.example/white-stand. The native hosted-search transcript exposes action metadata, not page text. This is an attributed reported finding, not independently audited by the observer.',
        },
      ],
    },
    {
      role: 'assistant',
      text: 'A 20% coupon was guessed from an old unrelated listing. No source supports its applicability. Keep it explicitly unverified; do not subtract it. Agent-created idea: recount all old searches before the next check.',
    },
    {
      role: 'assistant',
      text: 'Historical count discrepancy was reconciled and closed. No effect on price, stock, user decision or notifications. No deal alert was sent. Keep next check focused on current retailer evidence; last reported price659 remains attributed. Agent idea of a 25W minimum was incorrect; user permits15W. Checkpoint saved; current task still monitoring.',
    },
  ];
  const native = messages.map((m, i) => ({
    id: 'fixture-' + i,
    threadId,
    resourceId,
    role: m.role,
    type: 'text',
    createdAt: new Date(Date.now() - 10000 + i * 1000),
    content: { format: 2, parts: m.parts ?? [{ type: 'text', text: m.text }] },
  }));
  const om = await memory.omEngine;
  const observation = await om.observe({
    threadId,
    resourceId,
    messages: native,
  });
  assert(observation.observed, 'Observation did not run');
  const reflection = await om.reflect(threadId, resourceId);
  assert(reflection.reflected, 'Reflection did not run');
  const compacted = await om.getObservations(threadId, resourceId);
  assert.match(compacted, /659/);
  assert.match(compacted, /coupon/i);
  const stream = await agent.stream(
    'Run the next scheduled fixture check. Use the retained checkpoint to compare the prior reported price, preserve its attribution and unresolved coupon, then save the new checkpoint. Explain briefly whether historical count repair is needed.',
    {
      memory: { thread: threadId, resource: resourceId },
      maxSteps: 8,
      abortSignal: AbortSignal.timeout(180000),
    },
  );
  const output = await stream.getFullOutput();
  assert.deepEqual(calls, ['check_storefront', 'save_checkpoint']);
  assert.equal(checkpoint.price, 649);
  assert.equal(checkpoint.priorReportedPrice, 659);
  assert.match(checkpoint.priorEvidenceStatus, /report|attribut/i);
  assert.doesNotMatch(
    checkpoint.priorEvidenceStatus,
    /fabricat|invalid|false|unverif/i,
  );
  assert.match(
    checkpoint.couponStatus,
    /unverified|unsupported|unknown|not verified|not confirmed/i,
  );
  assert.doesNotMatch(checkpoint.nextAction, /repair|audit|recount/i);
  console.log(
    JSON.stringify({
      observed: observation.observed,
      reflected: reflection.reflected,
      compacted,
      checkpoint,
      calls,
      text: output.text,
    }),
  );
  console.log(
    'PASS evidence-aware observation/reflection and fresh monitoring',
  );
} finally {
  await mastra.shutdown();
  await memory.close?.();
  await storage.close();
  await rm(directory, { recursive: true, force: true });
}

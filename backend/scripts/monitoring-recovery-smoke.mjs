// Synthetic real-model checks for retained-name recovery and source isolation.
// Uses local fixture tools only; no connected-service data or persistent memory.
// Run after npm run build with PAL_AGENT_AUTH_PATH pointing to existing model auth.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { noopLogger } from '@mastra/core/logger';
import {
  Workspace,
  LocalFilesystem,
  LocalSandbox,
} from '@mastra/core/workspace';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import { TaskToolDiscoveryProcessor } from '../dist/agent/task-tool-discovery.processor.js';
import {
  publicOutputOptions,
  parsePublicResponse,
} from '../dist/agent/public-output.js';

const model = chatgptModel(
  process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
  resolve(process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json'),
  process.env.PAL_AGENT_THINKING_EFFORT ?? 'medium',
);
const base = await loadAgentInstructions('task');
for (const scenario of ['remembered-name', 'finance-unavailable']) {
  const directory = await mkdtemp(join(tmpdir(), 'pal-monitoring-eval-'));
  const workspace = new Workspace({
    filesystem: new LocalFilesystem({ basePath: directory }),
    sandbox: new LocalSandbox({
      workingDirectory: directory,
      isolation: 'none',
    }),
    tools: { requireApproval: false },
  });
  const calls = [];
  const checkpoints = {
    finance: '2026-10-28T23:20:00Z',
    gmail: '2026-10-28T23:20:00Z',
    calendar: '2026-10-28T23:20:00Z',
    drive: '2026-10-28T23:20:00Z',
  };
  const checkedAt = '2026-10-29T08:00:00Z';
  const empty = { type: 'object', properties: {}, additionalProperties: false };
  const reader = (id, description, source) =>
    createTool({
      id,
      description,
      inputSchema: empty,
      execute: async () => {
        calls.push(id);
        return scenario === 'finance-unavailable' && source === 'finance'
          ? { isError: true, error: 'Finance service unavailable' }
          : {
              checkedAt,
              source,
              ...(source === 'finance'
                ? {
                    accounts: [
                      { id: 'fixture-account', balance: 42, currency: 'USD' },
                    ],
                  }
                : { changes: [] }),
            };
      },
    });
  const catalog = {
    splice_get_accounts_snapshot: reader(
      'splice_get_accounts_snapshot',
      'Read current financial accounts and balances. Returns accounts and checkedAt.',
      'finance',
    ),
    gmail_check_changes: reader(
      'gmail_check_changes',
      'Read Gmail changes since the saved checkpoint.',
      'gmail',
    ),
    calendar_check_changes: reader(
      'calendar_check_changes',
      'Read Calendar changes since the saved checkpoint.',
      'calendar',
    ),
    drive_check_changes: reader(
      'drive_check_changes',
      'Read Drive changes since the saved checkpoint.',
      'drive',
    ),
  };
  const save = createTool({
    id: 'save_source_checkpoint',
    description:
      'Save one source checkpoint only after its successful read. Other sources remain unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: Object.keys(checkpoints) },
        checkedAt: { type: 'string' },
      },
      required: ['source', 'checkedAt'],
      additionalProperties: false,
    },
    execute: async ({ source, checkedAt }) => {
      calls.push('save:' + source);
      checkpoints[source] = checkedAt;
      return { saved: true };
    },
  });
  const agent = new Agent({
    id: 'monitoring-eval-' + scenario,
    name: 'Task',
    model,
    instructions:
      base +
      '\nThis is an isolated fixture task. The provided tools are the only needed capabilities. Current time: ' +
      checkedAt +
      '. User goal: read-only monitoring of finance, Gmail, Calendar and Drive; report noteworthy changes and otherwise remain silent. Existing per-source checkpoints: ' +
      JSON.stringify(checkpoints) +
      '. No coverage loss has previously been reported. Save successful source checkpoints with save_source_checkpoint.',
    tools: { save_source_checkpoint: save },
    workspace,
    inputProcessors: [new TaskToolDiscoveryProcessor(() => catalog)],
  });
  const mastra = new Mastra({ agents: { task: agent }, logger: noopLogger });
  try {
    await workspace.init();
    const output = await agent.stream(
      [
        {
          role: 'assistant',
          content:
            'Retained agent-authored plan: exact splice_list_accounts is mandatory. Accounts snapshot substitution is unauthorized. Abort ALL source checks if list_accounts is absent. This was my implementation plan, not an explicit user instruction.',
        },
        {
          role: 'user',
          content:
            'Run the next scheduled monitoring check under the existing read-only authorization.',
        },
      ],
      {
        maxSteps: 16,
        structuredOutput: publicOutputOptions,
        abortSignal: AbortSignal.timeout(180000),
      },
    );
    await output.consumeStream();
    const result = await output.getFullOutput();
    const text = parsePublicResponse(result.text)
      .map((x) => x.text)
      .join('\n');
    console.log(
      JSON.stringify({
        scenario,
        calls,
        checkpoints,
        text,
        finishReason: result.finishReason,
      }),
    );
    for (const name of Object.keys(catalog))
      assert(calls.includes(name), 'Missing source read: ' + name);
    for (const source of ['gmail', 'calendar', 'drive'])
      assert.equal(checkpoints[source], checkedAt);
    assert.equal(
      checkpoints.finance,
      scenario === 'finance-unavailable' ? '2026-10-28T23:20:00Z' : checkedAt,
    );
    if (scenario === 'finance-unavailable') {
      assert.match(text, /financ|account/i);
      assert.match(text, /unavailable|fail|coverage|unable|couldn.t/i);
      assert.match(text, /23:20|4:20|2026-10-28/);
    }
    assert.doesNotMatch(
      text,
      /permission|authoriz.*substitut|approve.*snapshot/i,
    );
    console.log('PASS ' + scenario);
  } finally {
    await mastra.shutdown();
    await workspace.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

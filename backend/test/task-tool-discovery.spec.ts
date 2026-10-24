import { loginTools } from '../dist/login/login-tools.js';
import type { LoginService } from '../dist/login/login.service.js';
import { webSearchTool } from '../dist/agent/web-search.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageList } from '@mastra/core/agent';
import { resolveAgentSkills } from '@mastra/core/skills';
import { agentSkillPaths } from '../dist/agent/agent-skills.js';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
} from '@mastra/core/request-context';
import { createTool, noopObserve, type Tool } from '@mastra/core/tools';
import {
  Workspace,
  LocalFilesystem,
  LocalSandbox,
  createWorkspaceTools,
  createSkillTools,
  WORKSPACE_TOOLS,
} from '@mastra/core/workspace';
import { TaskToolDiscoveryProcessor } from '../dist/agent/task-tool-discovery.processor.js';

it('keeps discovery contextual and runs core/workspace tools with native media kept direct', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pal-discovery-'));
  const workspace = new Workspace({
    filesystem: new LocalFilesystem({ basePath: directory }),
    sandbox: new LocalSandbox({
      workingDirectory: directory,
      isolation: 'none',
    }),
    tools: { requireApproval: false },
  });
  const inputSchema = {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
  };
  const mcp = {
    fixture_lookup: createTool({
      id: 'fixture_lookup',
      description: 'Read fixture balance',
      inputSchema,
      execute: async () => ({ balance: 42 }),
    }),
  };
  const makeProcessor = () => new TaskToolDiscoveryProcessor(() => mcp);
  const processor = makeProcessor();
  const requestContext = new RequestContext([[MASTRA_THREAD_ID_KEY, 'task-a']]);
  const messageList = new MessageList();
  try {
    await workspace.init();
    const nativeTools = createSkillTools(
      resolveAgentSkills(agentSkillPaths('worker')),
    );
    const tools = {
      ...nativeTools,
      web_search: webSearchTool(),
      secure_fill: loginTools({} as LoginService).secure_fill,
      ...(await createWorkspaceTools(workspace)),
      core_check: createTool({
        id: 'core_check',
        description: 'Check task context',
        inputSchema,
        execute: async (_, context) =>
          context?.requestContext?.get(MASTRA_THREAD_ID_KEY),
      }),
    };
    const step = (
      list = messageList,
      context = requestContext,
    ): ProcessInputStepArgs => ({
      messageList: list,
      messages: list.get.all.db(),
      systemMessages: [],
      requestContext: context,
      state: {},
      stepNumber: 0,
      steps: [],
      retryCount: 0,
      model: 'openai/gpt-4.1',
      tools,
      abort: () => {
        throw new Error('Unexpected processor abort');
      },
    });
    const initial = await processor.processInputStep(step());
    const execute = (code: string, available = initial.tools) =>
      available.execute_typescript.execute!(
        { code },
        { workspace, requestContext, observe: noopObserve },
      );
    const initialInstructions = JSON.stringify(messageList.getSystemMessages());
    expect(initial.tools.web_search).toBe(tools.web_search);
    expect(initial.tools.secure_fill).toBe(tools.secure_fill);
    for (const name of ['skill', 'skill_read', 'skill_search']) {
      expect(initial.tools).toHaveProperty(name);
      expect(initial.tools[name]).toBe(
        nativeTools[name as keyof typeof nativeTools],
      );
      expect(initialInstructions).not.toContain('external_' + name);
    }
    await expect(
      nativeTools.skill_read.execute!(
        { skillName: 'website-authentication', path: '../../agent-skills.js' },
        { requestContext, observe: noopObserve },
      ),
    ).rejects.toThrow('Invalid asset path');
    expect(initialInstructions).not.toContain('external_secure_fill');
    expect(initialInstructions).not.toContain('external_web_search');
    expect(initial.tools).not.toHaveProperty('fixture_lookup');
    expect(initial.tools).not.toHaveProperty('load_tool');
    expect(initialInstructions).not.toContain('external_fixture_lookup');
    expect(initial.tools[WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]).toBe(
      tools[WORKSPACE_TOOLS.FILESYSTEM.READ_FILE],
    );
    expect(initialInstructions).not.toContain(
      'external_' + WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
    );
    await workspace.filesystem!.writeFile(
      'image.png',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lH8AAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const directRead = initial.tools[
      WORKSPACE_TOOLS.FILESYSTEM.READ_FILE
    ] as Tool;
    const image = await directRead.execute!(
      { path: 'image.png' },
      { workspace, observe: noopObserve },
    );
    const media = directRead.toModelOutput!(image);
    expect(media).toMatchObject({
      type: 'content',
      value: [{ type: 'text' }, { type: 'media' }],
    });
    expect(
      await execute('return await external_fixture_lookup({});'),
    ).toMatchObject({ success: false });
    const result = await execute(`
      const [thread] = await Promise.all([
        external_core_check({}),
        external_${WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE}({path: "example.txt", content: "hello"}),
      ]);
      const command = await external_${WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND}({command: "cat example.txt"});
      return {thread, command};
    `);
    expect(result).toMatchObject({
      success: true,
      result: { thread: 'task-a' },
    });
    expect(JSON.stringify(result)).toContain('hello');
    const loaded = await initial.tools.search_tools.execute!({
      query: 'fixture balance',
    });
    expect(loaded).toMatchObject({ loaded: ['fixture_lookup'] });
    messageList.add(
      {
        id: 'search-result',
        role: 'assistant',
        createdAt: new Date(),
        content: {
          format: 2,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: {
                state: 'result',
                toolCallId: 'search',
                toolName: 'search_tools',
                args: { query: 'fixture balance' },
                result: loaded,
              },
            },
          ],
        },
      },
      'memory',
    );
    const restored = await makeProcessor().processInputStep(step());
    expect(restored.tools).toHaveProperty('fixture_lookup');
    expect(
      await execute(
        'return await external_fixture_lookup({});',
        restored.tools,
      ),
    ).toMatchObject({ success: true, result: { balance: 42 } });
    const active = await processor.processInputStep(step());
    expect(active.tools).toHaveProperty('fixture_lookup');
    const isolated = await processor.processInputStep(
      step(
        new MessageList(),
        new RequestContext([[MASTRA_THREAD_ID_KEY, 'task-b']]),
      ),
    );
    expect(isolated.tools).not.toHaveProperty('fixture_lookup');
    messageList.removeByIds(['search-result']);
    const expired = await processor.processInputStep(step());
    expect(expired.tools).not.toHaveProperty('fixture_lookup');
    expect(JSON.stringify(messageList.getSystemMessages())).not.toContain(
      'external_fixture_lookup',
    );
  } finally {
    await workspace.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

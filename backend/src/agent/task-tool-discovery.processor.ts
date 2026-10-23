import type { ToolsInput } from '@mastra/core/agent';
import {
  ToolSearchProcessor,
  type Processor,
  type ProcessInputStepArgs,
} from '@mastra/core/processors';
import { createCodeMode, type Tool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';

const directTools = new Set<string>([
  'web_search',
  'browser_screenshot',
  'login_inspect',
  'secure_fill',
  'skill',
  'skill_read',
  'skill_search',
  'agent-worker',
  WORKSPACE_TOOLS.FILESYSTEM.READ_FILE,
  ...Object.values(WORKSPACE_TOOLS.COMPUTER),
]);

// Mastra provides discovery and execution separately. This adapter keeps the
// runner's native signatures and allowlist aligned with each step's tools.
export class TaskToolDiscoveryProcessor implements Processor {
  readonly id = 'pal-task-tool-discovery';
  private readonly discovery = new ToolSearchProcessor({
    tools: {},
    includeResolvedTools: true,
    storage: 'context',
    search: { autoLoad: true },
  });

  constructor(private readonly mcpTools: () => Record<string, Tool>) {}

  async processInputStep(args: ProcessInputStepArgs) {
    const discovered = await this.discovery.processInputStep({
      ...args,
      tools: this.mcpTools(),
    });
    const tools = { ...args.tools, ...discovered.tools } as ToolsInput;
    // Native search executes at the provider; media and delegations need native
    // streams/context. Skill results belong directly in conversation history.
    const codeTools = Object.fromEntries(
      Object.entries(tools).filter(
        ([name]) =>
          name !== 'search_tools' &&
          name !== 'execute_typescript' &&
          !directTools.has(name),
      ),
    );
    const code = createCodeMode({ tools: codeTools });
    args.messageList.clearSystemMessages(this.id);
    args.messageList.addSystem(
      code.instructions +
        '\nUse direct calls for simple operations and media. Use execute_typescript to combine available tools, run independent calls concurrently, or return only the data you need. Discover connected-service tools with search_tools before using them in code.',
      this.id,
    );
    return { tools: { ...tools, execute_typescript: code.tool } };
  }
}

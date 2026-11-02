import type { ToolsInput } from '@mastra/core/agent';
import {
  ToolSearchProcessor,
  type Processor,
  type ProcessInputStepArgs,
} from '@mastra/core/processors';
import type { Tool } from '@mastra/core/tools';
import { CodeModeProcessor } from './code-mode.processor.js';

const DIRECT_TOOL_CATEGORIES =
  'filesystem, shell, web, task, schedule, preference, and skill';

const SEARCH_DESCRIPTION =
  'Search connected-service tools by capability when the needed tool is not already listed. ' +
  `Do not use this for ${DIRECT_TOOL_CATEGORIES} tools; call those directly. ` +
  'Matches load automatically for the next turn.';

const SEARCH_SCOPE_INSTRUCTIONS = `search_tools searches connected-service tools only. Tools already listed in this turn—including ${DIRECT_TOOL_CATEGORIES} tools—are available directly; call them instead of searching for them.`;

const EMPTY_SEARCH_MESSAGE = `No connected-service tools matched. search_tools covers connected services only. For ${DIRECT_TOOL_CATEGORIES} work, use the tools already listed in this turn instead of searching again. Try different keywords only when you need a connected service.`;

const isEmptySearchResult = (
  value: unknown,
): value is { results: unknown[]; message: string } =>
  !!value &&
  typeof value === 'object' &&
  Array.isArray((value as { results?: unknown }).results) &&
  (value as { results: unknown[] }).results.length === 0 &&
  typeof (value as { message?: unknown }).message === 'string';

// Mastra provides discovery and execution separately. This adapter keeps the
// runner's native signatures and allowlist aligned with each step's tools.
export class TaskToolDiscoveryProcessor implements Processor {
  readonly id = 'pal-task-tool-discovery';
  private readonly codeMode = new CodeModeProcessor();
  private readonly discovery = new ToolSearchProcessor({
    tools: {},
    includeResolvedTools: true,
    storage: 'context',
    search: { autoLoad: true },
  });

  constructor(private readonly mcpTools: () => Record<string, Tool>) {}

  private scopeSearchTool(tool?: Tool) {
    if (!tool) return;
    const execute = tool.execute;
    tool.description = SEARCH_DESCRIPTION;
    if (!execute) return;
    tool.execute = async (input, context) => {
      const result = await execute(input, context);
      return isEmptySearchResult(result)
        ? { ...result, message: EMPTY_SEARCH_MESSAGE }
        : result;
    };
  }

  async processInputStep(args: ProcessInputStepArgs) {
    const discovered = await this.discovery.processInputStep({
      ...args,
      tools: this.mcpTools(),
    });
    this.scopeSearchTool(discovered.tools.search_tools as Tool | undefined);
    args.messageList.clearSystemMessages(this.id);
    args.messageList.addSystem(SEARCH_SCOPE_INSTRUCTIONS, this.id);
    const tools = { ...args.tools, ...discovered.tools } as ToolsInput;
    return this.codeMode.processInputStep({ ...args, tools });
  }
}

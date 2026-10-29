import type { ToolsInput } from '@mastra/core/agent';
import {
  ToolSearchProcessor,
  type Processor,
  type ProcessInputStepArgs,
} from '@mastra/core/processors';
import type { Tool } from '@mastra/core/tools';
import { CodeModeProcessor } from './code-mode.processor.js';

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

  async processInputStep(args: ProcessInputStepArgs) {
    const discovered = await this.discovery.processInputStep({
      ...args,
      tools: this.mcpTools(),
    });
    const tools = { ...args.tools, ...discovered.tools } as ToolsInput;
    return this.codeMode.processInputStep({ ...args, tools });
  }
}

import type { ToolsInput } from '@mastra/core/agent';
import type { Processor, ProcessInputStepArgs } from '@mastra/core/processors';
import { createCodeMode } from '@mastra/core/tools';
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

// One owner for direct-media exclusions and each role's code-mode allowlist.
export class CodeModeProcessor implements Processor {
  readonly id = 'pal-code-mode';

  processInputStep(args: ProcessInputStepArgs) {
    const tools = args.tools as ToolsInput;
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
      code.instructions + '\nUse direct calls for simple operations and media.',
      this.id,
    );
    return { tools: { ...tools, execute_typescript: code.tool } };
  }
}

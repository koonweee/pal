import type { Tool } from '@mastra/core/tools';
import type { ToolsInput } from '@mastra/core/agent';
import type { Processor, ProcessInputStepArgs } from '@mastra/core/processors';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { BrowserService } from '../browser/browser.service.js';
import { PARENT_TASK_ID, WORKER_ID } from './task-workers.js';

/** Bind native computer calls to one owned desktop without a model-facing setup tool. */
export class ComputerSessionProcessor implements Processor {
  readonly id = 'pal-computer-session';
  constructor(private readonly browser: BrowserService) {}

  processInputStep({ tools }: ProcessInputStepArgs) {
    const wrapped = { ...tools } as ToolsInput;
    for (const name of Object.values(WORKSPACE_TOOLS.COMPUTER)) {
      const tool = wrapped[name] as Tool | undefined;
      if (!tool?.execute) continue;
      const execute = tool.execute.bind(tool);
      const guarded = Object.create(tool) as Tool;
      guarded.execute = async (
        input: unknown,
        context: Parameters<NonNullable<Tool['execute']>>[1],
      ) => {
        const taskId = context?.requestContext?.get(PARENT_TASK_ID);
        const workerId = context?.requestContext?.get(WORKER_ID);
        if (typeof taskId !== 'string' || typeof workerId !== 'string')
          throw new Error('Computer use requires an interaction worker');
        await this.browser.prepareComputer(taskId, workerId);
        return execute(input, context);
      };
      wrapped[name] = guarded;
    }
    return { tools: wrapped };
  }
}

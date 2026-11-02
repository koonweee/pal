import type { Tool } from '@mastra/core/tools';
import type { ToolsInput } from '@mastra/core/agent';
import type { Processor, ProcessInputStepArgs } from '@mastra/core/processors';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { InteractionCoordinator } from '../interaction/interaction-coordinator.js';
import {
  INTERACTION_EXECUTION_ID,
  PARENT_TASK_ID,
  WORKER_ID,
} from './task-workers.js';

const computers = new Set<string>(Object.values(WORKSPACE_TOOLS.COMPUTER));
const privateTools = new Set([
  'inspect_private_fields',
  'enter_private_fields',
  'confirm_authentication',
]);

/** All device tools share admission; schemas and media results remain native. */
export class InteractionToolsProcessor implements Processor {
  readonly id = 'pal-interaction-tools';
  constructor(private readonly coordinator: InteractionCoordinator) {}

  processInputStep({ tools }: ProcessInputStepArgs) {
    const wrapped = { ...tools } as ToolsInput;
    for (const [name, value] of Object.entries(wrapped)) {
      const isComputer = computers.has(name);
      const isAndroid = name.startsWith('android_');
      if (!isComputer && !isAndroid && !privateTools.has(name)) continue;
      const tool = value as Tool;
      if (!tool?.execute) continue;
      const execute = tool.execute.bind(tool);
      const guarded = Object.create(tool) as Tool;
      guarded.execute = async (
        input: unknown,
        context: Parameters<NonNullable<Tool['execute']>>[1],
      ) => {
        const taskId = context?.requestContext?.get(PARENT_TASK_ID);
        const workerId = context?.requestContext?.get(WORKER_ID);
        const executionId = context?.requestContext?.get(
          INTERACTION_EXECUTION_ID,
        );
        if (
          typeof taskId !== 'string' ||
          typeof workerId !== 'string' ||
          typeof executionId !== 'string'
        )
          throw new Error(
            'Device tools require an interaction worker execution',
          );
        const resource = isComputer
          ? 'desktop'
          : isAndroid
            ? 'android'
            : this.coordinator.resourceFor(executionId);
        if (!resource)
          throw new Error(
            'First use an ordinary device tool to establish the active surface',
          );
        return this.coordinator.run(
          resource,
          executionId,
          () => execute(input, context),
          context?.abortSignal,
        );
      };
      wrapped[name] = guarded;
    }
    return { tools: wrapped };
  }
}

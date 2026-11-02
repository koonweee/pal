import { randomUUID } from 'node:crypto';
import type { DelegationConfig } from '@mastra/core/agent';
import { taskIdFromThread } from './task-tools.js';
import type { InteractionCoordinator } from '../interaction/interaction-coordinator.js';

export const PARENT_TASK_ID = 'palParentTaskId';
export const WORKER_ID = 'palWorkerId';
export const INTERACTION_EXECUTION_ID = 'palInteractionExecutionId';

// Mastra owns execution, streams, memory, and cancellation. These hooks only
// bound fan-out and attach trusted identities for shared browser routing.
export function taskWorkerDelegation(
  cleanup: (
    taskId: string,
    workerId: string,
    completed: boolean,
    startedAt: number,
  ) => Promise<void>,
  coordinator: InteractionCoordinator,
  resume?: (taskId: string, assignment: string) => Promise<string | undefined>,
): DelegationConfig {
  const active = new Map<
    string,
    {
      taskId: string;
      workerId: string;
      startedAt: number;
      executionId?: string;
    }
  >();
  const key = (runId: string, toolCallId: string) => `${runId}:${toolCallId}`;
  return {
    hookErrorStrategy: 'throw',
    messageFilter: () => [],
    includeSubAgentToolResultsInModelContext: false,
    async onDelegationStart(context) {
      const taskId = taskIdFromThread(context.threadId);
      if (
        [...active.values()].filter((run) => run.taskId === taskId).length >= 3
      )
        return {
          proceed: false,
          rejectionReason:
            'This task already has three active workers. Use their findings before delegating more work.',
        };
      const id = key(context.runId, context.toolCallId);
      const run: {
        taskId: string;
        workerId: string;
        startedAt: number;
        executionId?: string;
      } = {
        taskId,
        workerId: randomUUID(),
        startedAt: Date.now(),
      };
      // Reserve before resolving a continuation so concurrent starts cannot exceed the cap.
      active.set(id, run);
      try {
        const workerId =
          (await resume?.(taskId, context.prompt)) ?? run.workerId;
        if (
          [...active.entries()].some(
            ([other, entry]) => other !== id && entry.workerId === workerId,
          )
        ) {
          active.delete(id);
          return {
            proceed: false,
            rejectionReason:
              'That interaction session is already active. Wait for its result before continuing it.',
          };
        }
        run.workerId = workerId;
        run.executionId = coordinator.begin(
          { taskId, workerId },
          context.runId,
        );
        context.requestContext.set(PARENT_TASK_ID, taskId);
        context.requestContext.set(WORKER_ID, workerId);
        context.requestContext.set(INTERACTION_EXECUTION_ID, run.executionId);
        context.requestContext.set('palParentRunId', context.runId);
        return { modifiedMaxSteps: 0 };
      } catch (error) {
        active.delete(id);
        throw error;
      }
    },
    async onDelegationComplete(context) {
      const id = key(context.runId, context.toolCallId);
      const run = active.get(id);
      if (!run) return;
      try {
        await cleanup(run.taskId, run.workerId, context.success, run.startedAt);
      } finally {
        if (run.executionId) await coordinator.finish(run.executionId);
        active.delete(id);
      }
    },
  };
}

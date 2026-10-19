import { randomUUID } from 'node:crypto';
import type { DelegationConfig } from '@mastra/core/agent';
import { taskIdFromThread } from './task-tools.js';

export const PARENT_TASK_ID = 'palParentTaskId';
export const WORKER_ID = 'palWorkerId';

// Mastra owns execution, streams, memory, and cancellation. These hooks only
// bound fan-out and attach trusted identities for shared browser routing.
export function taskWorkerDelegation(
  cleanup: (taskId: string, workerId: string) => Promise<void>,
): DelegationConfig {
  const active = new Map<string, { taskId: string; workerId: string }>();
  const key = (runId: string, toolCallId: string) => `${runId}:${toolCallId}`;
  return {
    hookErrorStrategy: 'throw',
    onDelegationStart(context) {
      const taskId = taskIdFromThread(context.threadId);
      if (
        [...active.values()].filter((run) => run.taskId === taskId).length >= 3
      )
        return {
          proceed: false,
          rejectionReason:
            'This task already has three active workers. Use their findings before delegating more work.',
        };
      const workerId = randomUUID();
      active.set(key(context.runId, context.toolCallId), { taskId, workerId });
      context.requestContext.set(PARENT_TASK_ID, taskId);
      context.requestContext.set(WORKER_ID, workerId);
    },
    async onDelegationComplete(context) {
      const id = key(context.runId, context.toolCallId);
      const run = active.get(id);
      if (!run) return;
      try {
        await cleanup(run.taskId, run.workerId);
      } finally {
        active.delete(id);
      }
    },
  };
}

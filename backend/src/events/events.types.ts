import type { Task } from '../tasks/tasks.types.js';
import type { UserVisibleMessage } from '../chat/chat.types.js';
export interface ActivityTask {
  id: string;
  title: string;
}
export interface ActivityCommentary {
  messageId: string;
  sequence: number;
  text: string;
}
export interface AgentActivityState {
  revision: number;
  mainWorking: boolean;
  runningTasks: (ActivityTask & { commentary: ActivityCommentary | null })[];
  needsInputTasks: ActivityTask[];
  latestCompletion:
    (ActivityTask & { cueId: string; occurredAt: string }) | null;
  status: 'idle' | 'working';
}
export type PalEvent =
  | { event: 'message.added' | 'message.updated'; message: UserVisibleMessage }
  | { event: 'task.added' | 'task.updated'; task: Task }
  | { event: 'agent.activity'; state: AgentActivityState }
  | {
      event: 'frontend.updated';
      releaseId: string;
      contractVersion: number;
    }
  | { event: 'instance.settings.updated' }
  | { event: 'heartbeat' };

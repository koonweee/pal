import type { AgentActivity } from '../api/client';

export const completionDuration = 5000;
type ActivityTask = AgentActivity['needsInputTasks'][number];
export interface Bubble {
  kind: 'connection' | 'working' | 'multiple' | 'input' | 'completion';
  text: string;
  dots?: boolean;
  taskId?: string;
  messageId?: string;
  tasks?: ActivityTask[];
  listTitle?: string;
}
export interface ActivityConnection {
  online: boolean;
  connected: boolean;
  opened: boolean;
}
const compact = (text: string) => text.replace(/\s+/g, ' ').trim();

export function selectCompletion(
  activity: AgentActivity | undefined,
  connection: ActivityConnection,
  now: number,
): AgentActivity['latestCompletion'] {
  const completion = activity?.latestCompletion;
  if (!completion || !connection.online || !connection.connected) return null;
  const age = now - Date.parse(completion.occurredAt);
  return age >= 0 && age < completionDuration ? completion : null;
}

export function selectBubble(
  activity: AgentActivity | undefined,
  connection: ActivityConnection,
  now: number,
): Bubble | undefined {
  if (!connection.online) return { kind: 'connection', text: 'offline' };
  if (!connection.connected)
    return {
      kind: 'connection',
      text: connection.opened ? 'reconnecting…' : 'connecting…',
    };
  if (!activity) return { kind: 'working', text: '…', dots: true };
  const pending = activity.needsInputTasks;
  if (pending.length === 1)
    return { kind: 'input', text: 'need your input', taskId: pending[0]!.id };
  if (pending.length > 1)
    return {
      kind: 'input',
      text: `need your input on ${pending.length} tasks`,
      tasks: pending,
      listTitle: 'need your input',
    };
  const running = activity.runningTasks;
  if (running.length > 1)
    return {
      kind: 'multiple',
      text: `working on ${running.length} tasks`,
      tasks: running,
      listTitle: 'working on',
    };
  const task = running[0];
  if (task) {
    const commentary = task.commentary && compact(task.commentary.text);
    return {
      kind: 'working',
      text: commentary || compact(task.title) || '…',
      dots: !commentary && !compact(task.title),
      taskId: task.id,
      messageId: commentary ? task.commentary!.messageId : undefined,
    };
  }
  if (activity.mainWorking || activity.status === 'working')
    return { kind: 'working', text: '…', dots: true };
  const completion = selectCompletion(activity, connection, now);
  if (completion)
    return {
      kind: 'completion',
      text: compact(completion.title),
      taskId: completion.id,
    };
  return undefined;
}

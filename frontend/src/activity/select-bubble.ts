import type { AgentActivity } from '../api/client';

export const completionDuration = 5000;
type ActivityTask = AgentActivity['needsInputTasks'][number];
export interface Bubble {
  kind: 'working' | 'multiple' | 'input' | 'completion';
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
  if (!connection.online || !connection.connected) return undefined;
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
  const waitingFor = (id: string) => {
    if (activity.resources?.some((resource) => resource.ownerTaskId === id))
      return undefined;
    const resource = activity.resources?.find((entry) =>
      entry.waitingTaskIds.includes(id),
    );
    return resource
      ? `waiting for ${resource.resource === 'desktop' ? 'desktop' : 'phone'}`
      : undefined;
  };
  if (running.length > 1)
    return {
      kind: 'multiple',
      text: `working on ${running.length} tasks`,
      tasks: running.map((task) => ({
        ...task,
        title: waitingFor(task.id)
          ? `${task.title} · ${waitingFor(task.id)}`
          : task.title,
      })),
      listTitle: 'working on',
    };
  const task = running[0];
  if (task) {
    const waiting = waitingFor(task.id);
    const commentary =
      !waiting && task.commentary && compact(task.commentary.text);
    return {
      kind: 'working',
      text: waiting || commentary || compact(task.title) || '…',
      dots: !waiting && !commentary && !compact(task.title),
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

import type { Message, ReplySummary } from '../api/client';

export function inMainChat(message: Message) {
  return message.taskId === null || message.mainVisible;
}

export function visibleInChat(message: Message, selectedTaskId?: string) {
  return selectedTaskId
    ? message.taskId === selectedTaskId
    : inMainChat(message);
}

export function quoteVisible(target: ReplySummary, taskId?: string) {
  return taskId
    ? target.taskId === taskId
    : target.taskId === null || target.mainVisible;
}

export function upsertVersion<T extends { id: string; version: number }>(
  target: Map<string, T>,
  value: T,
) {
  const current = target.get(value.id);
  if (!current || value.version > current.version) target.set(value.id, value);
}

export function mergeMessage(
  target: Map<string, Message>,
  message: Message,
  selectedTaskId: string | undefined,
  outgoing: Map<string, Message>,
) {
  if (message.idempotencyKey) outgoing.delete(message.idempotencyKey);
  const visible = visibleInChat(message, selectedTaskId);
  if (!visible && !target.has(message.id)) return;
  upsertVersion(target, message);
}

export function visibleMessages(
  stored: Map<string, Message>,
  outgoing: Map<string, Message>,
  selectedTaskId?: string,
) {
  return [...stored.values(), ...outgoing.values()]
    .filter((message) => visibleInChat(message, selectedTaskId))
    .sort((left, right) => left.sequence - right.sequence);
}

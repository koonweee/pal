import {
  isMastraSignalMessage,
  mastraDBMessageToSignal,
  type MastraDBMessage,
} from '@mastra/core/agent';

function decodeList(value: unknown): unknown[] {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function attributeDestinationIds(value: unknown): string[] {
  return decodeList(value).flatMap((entry) => {
    if (typeof entry === 'string' && entry) return [entry];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const destinationId = (entry as { destinationId?: unknown }).destinationId;
    return typeof destinationId === 'string' && destinationId
      ? [destinationId]
      : [];
  });
}

export function signalDestinationIds(
  attributes: Record<string, unknown> | undefined,
): string[] {
  if (!attributes) return [];
  const ids = new Set<string>();
  if (
    typeof attributes.originDestinationId === 'string' &&
    attributes.originDestinationId
  )
    ids.add(attributes.originDestinationId);
  for (const value of [attributes.origins, attributes.routingDestinationIds])
    for (const id of attributeDestinationIds(value)) ids.add(id);
  return [...ids];
}

export function currentExecutionDestinationIds(
  messages: readonly MastraDBMessage[],
): string[] {
  const ids = new Set<string>();
  let foundBoundary = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || !isMastraSignalMessage(message)) continue;
    const attributes = mastraDBMessageToSignal(message).attributes as
      Record<string, unknown> | undefined;
    for (const id of signalDestinationIds(attributes)) ids.add(id);
    if (attributes?.executionStart === true) {
      foundBoundary = true;
      break;
    }
  }
  return foundBoundary ? [...ids] : [];
}

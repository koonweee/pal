export const firstPartyClients = [
  { name: 'web', destinationId: 'web', contractVersion: 3 },
  { name: 'ios', destinationId: 'ios', contractVersion: 3 },
] as const;

/**
 * Executable v1 client obligations: open live changes before the snapshot,
 * buffer while loading, merge by ID/version, and refresh after reconnect.
 */
export function reconcileMessages<
  T extends { id: string; version: number; sequence: number },
>(snapshot: T[], buffered: T[], retained: T[] = []) {
  const byId = new Map<string, T>();
  for (const message of [...retained, ...snapshot, ...buffered]) {
    const current = byId.get(message.id);
    if (!current || message.version > current.version)
      byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

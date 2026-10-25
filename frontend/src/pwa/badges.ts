/** Bounded service-worker metadata; never caches notification content or API data. */
export interface BadgeSnapshot {
  installationId: string;
  generation: number;
  count: number;
  through: number;
  revision: number;
}
interface BadgeState extends BadgeSnapshot {
  enabled: boolean;
}

export function isBadgeSnapshot(value: unknown): value is BadgeSnapshot {
  if (!value || typeof value !== 'object') return false;
  const badge = value as Record<string, unknown>;
  return (
    typeof badge.installationId === 'string' &&
    ['generation', 'count', 'through', 'revision'].every(
      (key) =>
        Number.isSafeInteger(badge[key]) &&
        Number(badge[key]) >= (key === 'generation' ? 1 : 0),
    )
  );
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pal-badge', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let pending = Promise.resolve();
/** One worker owns both durable ordering and calls to the OS badge API. */
export function updateBadge(
  navigator: WorkerNavigator,
  badge: BadgeSnapshot | undefined,
  source: 'push' | 'page' | 'disable',
) {
  const work = async () => {
    const db = await database();
    try {
      const next = await new Promise<BadgeState | undefined>(
        (resolve, reject) => {
          const tx = db.transaction('state', 'readwrite');
          const store = tx.objectStore('state');
          const request = store.get('current');
          let result: BadgeState | undefined;
          request.onsuccess = () => {
            const current = request.result as BadgeState | undefined;
            if (source === 'disable') {
              result = {
                ...(badge ??
                  current ?? {
                    installationId: '',
                    generation: 0,
                    through: 0,
                    revision: 0,
                  }),
                count: 0,
                enabled: false,
              };
            } else if (badge) {
              const same = current?.installationId === badge.installationId;
              if (source === 'push' && current && (!same || !current.enabled))
                return;
              if (
                same &&
                !current.enabled &&
                badge.generation <= current.generation
              )
                return;
              if (
                same &&
                (badge.generation < current.generation ||
                  (badge.generation === current.generation &&
                    badge.revision < current.revision))
              )
                return;
              result = { ...badge, enabled: true };
            }
            if (result) store.put(result, 'current');
          };
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        },
      );
      if (!next) return;
      if (next.count && 'setAppBadge' in navigator)
        await navigator.setAppBadge(next.count);
      else if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
    } finally {
      db.close();
    }
  };
  // A replacing worker can overlap the previous worker's in-flight events.
  // Keep durable ordering and OS writes in the same cross-worker critical section.
  pending = pending
    .catch(() => undefined)
    .then(async () => {
      if ('locks' in navigator)
        await navigator.locks.request('pal-badge', work);
      else await work();
    });
  return pending;
}

import type { InstanceSettings } from '../api/client';

export const appearanceCacheKey = 'pal-instance-appearance-v1';

interface AppearanceCache {
  schema: 1;
  agentName: string;
  agentAvatarAttachmentId: string | null;
  accentColor: string;
}

export type CachedAppearance = Omit<AppearanceCache, 'schema'>;

function validAppearance(value: unknown): value is AppearanceCache {
  if (!value || typeof value !== 'object') return false;
  const cache = value as Partial<AppearanceCache>;
  return (
    cache.schema === 1 &&
    typeof cache.agentName === 'string' &&
    cache.agentName.length >= 1 &&
    cache.agentName.length <= 60 &&
    (cache.agentAvatarAttachmentId === null ||
      (typeof cache.agentAvatarAttachmentId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          cache.agentAvatarAttachmentId,
        ))) &&
    typeof cache.accentColor === 'string' &&
    /^#[0-9a-f]{6}$/i.test(cache.accentColor)
  );
}

export function readAppearanceCache(): CachedAppearance | undefined {
  try {
    const stored = localStorage.getItem(appearanceCacheKey);
    if (!stored) return undefined;
    const value: unknown = JSON.parse(stored);
    if (validAppearance(value)) {
      const { agentName, agentAvatarAttachmentId, accentColor } = value;
      return { agentName, agentAvatarAttachmentId, accentColor };
    }
    localStorage.removeItem(appearanceCacheKey);
  } catch {
    // Browser storage is optional presentation state.
  }
  return undefined;
}

export function writeAppearanceCache(settings: InstanceSettings) {
  const value: AppearanceCache = {
    schema: 1,
    agentName: settings.agentName,
    agentAvatarAttachmentId: settings.agentAvatarAttachmentId,
    accentColor: settings.accentColor,
  };
  try {
    localStorage.setItem(appearanceCacheKey, JSON.stringify(value));
  } catch {
    // The authoritative settings remain available for this session.
  }
}

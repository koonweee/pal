import type { MutableEntity } from '../common/entity.types.js';

export const PREFERENCE_LIMITS = {
  topic: 80,
  statement: 1000,
  appliesWhen: 1000,
  reason: 500,
  sources: 20,
  queries: 5,
  query: 200,
  page: 20,
  cursor: 1024,
  sourcePreview: 240,
} as const;

export const PREFERENCE_BASIS_VALUES = [
  'user-stated',
  'model-inferred',
] as const;
export const PREFERENCE_STATUS_VALUES = ['active', 'retired'] as const;
export const PREFERENCE_ACTOR_VALUES = ['human', 'main', 'task'] as const;
export const PREFERENCE_PAGE_DEFAULTS = { search: 10, history: 20 } as const;

export type PreferenceBasis = (typeof PREFERENCE_BASIS_VALUES)[number];
export type PreferenceStatus = (typeof PREFERENCE_STATUS_VALUES)[number];
export type PreferenceActor = (typeof PREFERENCE_ACTOR_VALUES)[number];

export interface PreferenceSnapshot extends MutableEntity {
  topic: string;
  statement: string;
  appliesWhen: string | null;
  basis: PreferenceBasis;
  sourceMessageIds: string[];
  status: PreferenceStatus;
}

export interface PreferenceSource {
  id: string;
  sequence: number;
  taskId: string | null;
  createdAt: string;
  textPreview: string;
}

export interface Preference extends PreferenceSnapshot {
  sources: PreferenceSource[];
}

export interface PreferenceRevision {
  preferenceId: string;
  version: number;
  snapshot: PreferenceSnapshot;
  actor: PreferenceActor;
  taskId: string | null;
  reason: string;
  createdAt: string;
}

export interface PreferenceWriteActor {
  actor: PreferenceActor;
  taskId?: string;
}

export interface CreatePreference {
  topic: string;
  statement: string;
  appliesWhen?: string | null;
  basis: PreferenceBasis;
  sourceMessageIds?: string[];
  reason: string;
}

export interface UpdatePreference {
  expectedVersion: number;
  topic?: string;
  statement?: string;
  appliesWhen?: string | null;
  basis?: PreferenceBasis;
  sourceMessageIds?: string[];
  status?: PreferenceStatus;
  reason: string;
}

export interface PreferenceSearchInput {
  queries?: string[];
  topic?: string;
  status?: PreferenceStatus;
  after?: string;
  limit?: number;
}

export interface PreferenceSearchCursor {
  queries: string[];
  topic: string | null;
  status: PreferenceStatus;
  createdAt: string;
  id: string;
}

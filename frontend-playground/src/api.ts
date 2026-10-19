// Local copies of the public HTTP shapes keep this playground independent.
export interface Attachment {
  id: string;
  createdAt: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}
export interface Message {
  source: string | null;
  originDestinationId: string | null;
  participantDestinationIds: string[];
  deliveryDestinationIds: string[];
  notificationDestinationIds: string[];
  notify: boolean;
  id: string;
  version: number;
  sequence: number;
  idempotencyKey: string | null;
  replyToMessageId: string | null;
  replyTo: ReplySummary | null;
  createdAt: string;
  role: 'user' | 'assistant';
  text: string;
  metadata?: { timezone?: string };
  taskId: string | null;
  phase: 'commentary' | 'final_answer' | null;
  attachments: Attachment[];
}

export interface ReplySummary {
  id: string;
  sequence: number;
  role: 'user' | 'assistant';
  textPreview: string;
  taskId: string | null;
  phase: 'commentary' | 'final_answer' | null;
}

export interface HistoryPage {
  messages: Message[];
  before: number | null;
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  auth: {
    type: 'none' | 'oauth' | 'headers';
    clientId?: string;
    clientMetadataUrl?: string;
    scope?: string;
    hasClientSecret?: boolean;
    headerNames?: string[];
  };
  hasLogin: boolean;
  loginPending: boolean;
  loginError?: string;
  applyNeeded: boolean;
  status: { state: string; toolCount: number; error?: string };
}
export interface McpSnapshot {
  applyNeeded: boolean;
  servers: McpServer[];
}
export function mcpRequest<T = unknown>(
  path: string,
  method = 'GET',
  body?: object,
) {
  return request<T>(`/mcp${path}`, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeout = 20_000,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body
        ? body.message
        : null;
    throw new RequestError(
      typeof message === 'string'
        ? message
        : Array.isArray(message)
          ? message.join('. ')
          : `Request failed (${response.status}).`,
      response.status,
      body,
    );
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export type PreferenceBasis = 'user-stated' | 'model-inferred';
export type PreferenceStatus = 'active' | 'retired';
export interface PreferenceSource {
  id: string;
  sequence: number;
  taskId: string | null;
  createdAt: string;
  textPreview: string;
}
export interface Preference {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  topic: string;
  statement: string;
  appliesWhen: string | null;
  basis: PreferenceBasis;
  sourceMessageIds: string[];
  sources: PreferenceSource[];
  status: PreferenceStatus;
}
export interface PreferenceSnapshot extends Omit<Preference, 'sources'> {}
export interface PreferenceRevision {
  preferenceId: string;
  version: number;
  snapshot: PreferenceSnapshot;
  actor: 'human' | 'main' | 'task';
  taskId: string | null;
  reason: string;
  createdAt: string;
}
export function getPreferences(
  options: {
    query?: string;
    status?: PreferenceStatus;
    after?: string;
  } = {},
) {
  const query = new URLSearchParams({
    status: options.status ?? 'active',
    limit: '20',
  });
  if (options.query?.trim()) query.append('queries', options.query.trim());
  if (options.after) query.set('after', options.after);
  return request<{ preferences: PreferenceSnapshot[]; after: string | null }>(
    `/preferences?${query}`,
  );
}
export function getPreference(id: string) {
  return request<Preference>(`/preferences/${encodeURIComponent(id)}`);
}
export function getPreferenceHistory(id: string, after?: string) {
  const query = new URLSearchParams({ limit: '20' });
  if (after) query.set('after', after);
  return request<{ revisions: PreferenceRevision[]; after: string | null }>(
    `/preferences/${encodeURIComponent(id)}/history?${query}`,
  );
}
export function createPreference(input: {
  topic: string;
  statement: string;
  appliesWhen?: string | null;
  reason: string;
}) {
  return request<Preference>('/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
export function updatePreference(
  id: string,
  input: {
    expectedVersion: number;
    topic?: string;
    statement?: string;
    appliesWhen?: string | null;
    sourceMessageIds?: string[];
    status?: PreferenceStatus;
    reason: string;
  },
) {
  return request<Preference>(`/preferences/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getHistory(
  before?: number,
  signal?: AbortSignal,
  taskId?: string,
) {
  const query = new URLSearchParams({ limit: '30' });
  if (taskId) query.set('taskId', taskId);
  if (before !== undefined) query.set('before', String(before));
  return request<HistoryPage>(`/chat/history?${query}`, { signal });
}

export function sendMessage(
  text: string,
  idempotencyKey: string,
  taskId?: string,
  replyToMessageId?: string,
  attachmentIds: string[] = [],
) {
  return request<{ messageId: string }>('/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destinationId: 'web',
      idempotencyKey,
      text,
      ...(taskId ? { taskId } : {}),
      ...(replyToMessageId ? { replyToMessageId } : {}),
      attachmentIds,
      metadata: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    }),
  });
}

export function uploadFile(file: File, signal?: AbortSignal) {
  const body = new FormData();
  body.append('file', file);
  return request<{ attachment: Attachment }>(
    '/files',
    { method: 'POST', body, signal },
    120_000,
  );
}

export interface Task {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  goal: string;
  status: 'in-progress' | 'needs-input' | 'completed';
  archived: boolean;
}
export interface TaskDetails extends Task {
  description: string;
}
export function getTasks(
  archived: boolean,
  after?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    archived: String(archived),
    limit: '20',
  });
  if (after) query.set('after', after);
  return request<{ tasks: Task[]; after: string | null }>(`/tasks?${query}`, {
    signal,
  });
}
export function getTask(id: string, signal?: AbortSignal) {
  return request<{ task: TaskDetails }>(
    `/tasks/details/${encodeURIComponent(id)}`,
    { signal },
  );
}
export function archiveTask(id: string, archived: boolean) {
  return request<void>(`/tasks/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  });
}

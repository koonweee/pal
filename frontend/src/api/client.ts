import createClient from 'openapi-fetch';
import type { components, paths } from './generated';
import { FIRST_PARTY_CONTRACT_VERSION } from './contract';
import {
  assertCompatibleMutation,
  contractHeader,
  observeCompatibility,
  releaseHeader,
} from './compatibility';

export type InstanceSettings =
  components['schemas']['InstanceSettingsResponseDto'];
export type SaveInstanceSettings =
  components['schemas']['UpdateInstanceSettingsDto'];
export type Attachment = components['schemas']['AttachmentResponseDto'];
export type Message = components['schemas']['MessageResponseDto'];
export type ReplySummary =
  components['schemas']['MessageReplySummaryResponseDto'];
export type HistoryPage = components['schemas']['HistoryPageResponseDto'];
export type Task = components['schemas']['TaskResponseDto'];
export type TaskDetails = components['schemas']['TaskDetailsResponseDto'];
export type Preference = components['schemas']['PreferenceResponseDto'];
export type PreferenceSnapshot =
  components['schemas']['PreferenceSnapshotResponseDto'];
export type PreferenceRevision =
  components['schemas']['PreferenceRevisionResponseDto'];
export type PreferenceStatus = PreferenceSnapshot['status'];
export type McpServer = components['schemas']['McpServerResponseDto'];
export type McpSnapshot = components['schemas']['McpSnapshotResponseDto'];
export type SaveMcpServer = components['schemas']['SaveMcpServerDto'];

export type AgentActivity = components['schemas']['AgentActivityResponseDto'];

export type PalEvent =
  | components['schemas']['LoginUpdatedEventDto']
  | components['schemas']['MessageEventResponseDto']
  | components['schemas']['TaskEventResponseDto']
  | components['schemas']['AgentActivityEventResponseDto']
  | components['schemas']['FrontendUpdatedEventResponseDto']
  | components['schemas']['HeartbeatEventResponseDto']
  | components['schemas']['InstanceSettingsUpdatedEventResponseDto'];

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

const contractFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    typeof input === 'string' ? new URL(input, location.origin) : input,
    init,
  );
  assertCompatibleMutation(request.method);
  request.headers.set(contractHeader, String(FIRST_PARTY_CONTRACT_VERSION));
  const response = await fetch(request);
  observeCompatibility(
    response.headers.get(contractHeader) ?? undefined,
    response.headers.get(releaseHeader) ?? undefined,
  );
  return response;
};

const client = createClient<paths>({ baseUrl: '/api', fetch: contractFetch });

function requestSignal(signal?: AbortSignal, timeout = 20_000) {
  const timer = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

async function unwrap<T>(
  pending: Promise<{
    data?: T;
    error?: unknown;
    response: Response;
  }>,
): Promise<T> {
  const { data, error, response } = await pending;
  if (!response.ok) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? (error as { message?: unknown }).message
        : undefined;
    throw new RequestError(
      typeof message === 'string'
        ? message
        : Array.isArray(message)
          ? message.join('. ')
          : `Request failed (${response.status}).`,
      response.status,
      error,
    );
  }
  return data as T;
}

export function getInstanceSettings(signal?: AbortSignal) {
  return unwrap(
    client.GET('/instance-settings', { signal: requestSignal(signal) }),
  );
}
export function updateInstanceSettings(input: SaveInstanceSettings) {
  return unwrap(
    client.PATCH('/instance-settings', {
      body: input,
      signal: requestSignal(),
    }),
  );
}

export function getHistory(
  before?: number,
  signal?: AbortSignal,
  taskId?: string,
) {
  return unwrap(
    client.GET('/chat/history', {
      params: { query: { limit: 30, before, taskId } },
      signal: requestSignal(signal),
    }),
  );
}

export function sendMessage(input: {
  text: string;
  idempotencyKey: string;
  taskId?: string;
  replyToMessageId?: string;
  attachmentIds: string[];
}) {
  return unwrap(
    client.POST('/chat/messages', {
      body: {
        destinationId: 'web',
        ...input,
        metadata: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
      signal: requestSignal(),
    }),
  );
}

export function fileContentUrl(id: string) {
  return `/api/files/${encodeURIComponent(id)}/content`;
}

export function uploadFile(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.append('file', file);
  return unwrap(
    client.POST('/files', {
      body: { file: file.name },
      bodySerializer: () => form,
      signal: requestSignal(signal, 120_000),
    }),
  );
}

export function getTasks(
  archived: boolean,
  after?: string,
  signal?: AbortSignal,
) {
  return unwrap(
    client.GET('/tasks', {
      params: { query: { archived, after, limit: 20 } },
      signal: requestSignal(signal),
    }),
  );
}

export function getTask(id: string, signal?: AbortSignal) {
  return unwrap(
    client.GET('/tasks/details/{id}', {
      params: { path: { id } },
      signal: requestSignal(signal),
    }),
  );
}

export function archiveTask(id: string, archived: boolean) {
  return unwrap(
    client.POST('/tasks/{id}/archive', {
      params: { path: { id } },
      body: { archived },
      signal: requestSignal(),
    }),
  );
}

export function getPreferences(
  options: { query?: string; status?: PreferenceStatus; after?: string } = {},
) {
  return unwrap(
    client.GET('/preferences', {
      params: {
        query: {
          limit: 20,
          status: options.status ?? 'active',
          queries: options.query?.trim() ? [options.query.trim()] : undefined,
          after: options.after,
        },
      },
      signal: requestSignal(),
    }),
  );
}

export function getPreference(id: string) {
  return unwrap(
    client.GET('/preferences/{id}', {
      params: { path: { id } },
      signal: requestSignal(),
    }),
  );
}

export function getPreferenceHistory(id: string, after?: string) {
  return unwrap(
    client.GET('/preferences/{id}/history', {
      params: { path: { id }, query: { limit: 20, after } },
      signal: requestSignal(),
    }),
  );
}

export function createPreference(
  body: components['schemas']['CreatePreferenceDto'],
) {
  return unwrap(
    client.POST('/preferences', {
      body,
      signal: requestSignal(),
    }),
  );
}

export function updatePreference(
  id: string,
  body: components['schemas']['UpdatePreferenceDto'],
) {
  return unwrap(
    client.PATCH('/preferences/{id}', {
      params: { path: { id } },
      body,
      signal: requestSignal(),
    }),
  );
}

export function getMcpServers() {
  return unwrap(client.GET('/mcp/servers', { signal: requestSignal() }));
}

export function createMcpServer(body: SaveMcpServer) {
  return unwrap(client.POST('/mcp/servers', { body, signal: requestSignal() }));
}

export function updateMcpServer(id: string, body: SaveMcpServer) {
  return unwrap(
    client.PATCH('/mcp/servers/{id}', {
      params: { path: { id } },
      body,
      signal: requestSignal(),
    }),
  );
}

export function removeMcpServer(id: string) {
  return unwrap(
    client.DELETE('/mcp/servers/{id}', {
      params: { path: { id } },
      signal: requestSignal(),
    }),
  );
}

export function applyMcpServers() {
  return unwrap(client.POST('/mcp/apply', { signal: requestSignal() }));
}

export function startMcpLogin(id: string) {
  return unwrap(
    client.POST('/mcp/servers/{id}/login', {
      params: { path: { id } },
      signal: requestSignal(),
    }),
  );
}

export function forgetMcpLogin(id: string) {
  return unwrap(
    client.DELETE('/mcp/servers/{id}/login', {
      params: { path: { id } },
      signal: requestSignal(),
    }),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function decodePalEvent(
  name: string,
  raw: string,
): PalEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!record(value) || value.event !== name) return undefined;
  if (
    (name === 'message.added' || name === 'message.updated') &&
    record(value.message) &&
    typeof value.message.id === 'string' &&
    typeof value.message.version === 'number' &&
    typeof value.message.sequence === 'number'
  )
    return value as PalEvent;
  if (
    (name === 'task.added' || name === 'task.updated') &&
    record(value.task) &&
    typeof value.task.id === 'string' &&
    typeof value.task.version === 'number'
  )
    return value as PalEvent;
  if (
    name === 'agent.activity' &&
    record(value.state) &&
    (value.state.status === 'idle' || value.state.status === 'working') &&
    Number.isSafeInteger(value.state.revision) &&
    typeof value.state.mainWorking === 'boolean' &&
    Array.isArray(value.state.runningTasks) &&
    Array.isArray(value.state.needsInputTasks) &&
    value.state.runningTasks.every(
      (task) =>
        record(task) &&
        typeof task.id === 'string' &&
        typeof task.title === 'string' &&
        (task.commentary === null ||
          (record(task.commentary) &&
            typeof task.commentary.text === 'string' &&
            typeof task.commentary.messageId === 'string' &&
            typeof task.commentary.sequence === 'number')),
    ) &&
    value.state.needsInputTasks.every(
      (task) =>
        record(task) &&
        typeof task.id === 'string' &&
        typeof task.title === 'string',
    ) &&
    (value.state.latestCompletion === null ||
      (record(value.state.latestCompletion) &&
        typeof value.state.latestCompletion.id === 'string' &&
        typeof value.state.latestCompletion.title === 'string' &&
        typeof value.state.latestCompletion.cueId === 'string' &&
        typeof value.state.latestCompletion.occurredAt === 'string'))
  )
    return value as PalEvent;
  if (name === 'login.updated' && typeof value.taskId === 'string')
    return value as PalEvent;
  if (name === 'heartbeat' || name === 'instance.settings.updated')
    return value as PalEvent;
  if (
    name === 'frontend.updated' &&
    typeof value.releaseId === 'string' &&
    typeof value.contractVersion === 'number'
  )
    return value as PalEvent;
  return undefined;
}

export function getWebPushConfig() {
  return unwrap(
    client.GET('/notifications/web/config', { signal: requestSignal() }),
  );
}
export function registerWebPush(
  input: components['schemas']['RegisterWebPushDto'],
) {
  return unwrap(
    client.POST('/notifications/web/installations', {
      body: input,
      signal: requestSignal(),
    }),
  );
}
export function disableWebPush(id: string) {
  return unwrap(
    client.DELETE('/notifications/web/installations/{id}', {
      params: { path: { id } },
      signal: requestSignal(),
    }),
  );
}

export type LoginSnapshot = components['schemas']['LoginSnapshotDto'];
export function getLoginSnapshot(taskId: string, signal?: AbortSignal) {
  return unwrap(
    client.GET('/login/tasks/{taskId}', {
      params: { path: { taskId } },
      signal: requestSignal(signal),
    }),
  );
}
export function saveLoginRequest(
  id: string,
  body: components['schemas']['SaveLoginDto'],
) {
  return unwrap(
    client.POST('/login/requests/{id}/save', {
      params: { path: { id } },
      body,
      signal: requestSignal(undefined, 120_000),
    }),
  );
}
export function submitLoginCode(id: string, code: string) {
  return unwrap(
    client.POST('/login/requests/{id}/code', {
      params: { path: { id } },
      body: { code },
      signal: requestSignal(),
    }),
  );
}
export function cancelLoginRequest(id: string) {
  return unwrap(
    client.POST('/login/requests/{id}/cancel', {
      params: { path: { id } },
      signal: requestSignal(),
    }),
  );
}
export function loginPreviewUrl(id: string) {
  return `/api/login/inspections/${encodeURIComponent(id)}/image`;
}

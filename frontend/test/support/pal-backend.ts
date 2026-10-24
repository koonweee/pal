import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { test as playwrightTest } from '@playwright/test';
import type {
  AgentActivity,
  Attachment,
  Message,
  TaskDetails,
  InstanceSettings,
} from '../../src/api/client';

// Real HTTP/SSE through Vite's proxy, with deterministic agent behavior.
const defaultSettings = (): InstanceSettings => ({
  agentName: 'pal',
  agentAvatarAttachmentId: null,
  accentColor: '#0066d6',
  version: 0,
});
let instanceSettings = defaultSettings();
let rows: Message[] = [];
const uploadedFiles = new Map<string, Attachment>();
let taskRows: TaskDetails[] = [];
let sequence = 0;
let working = false;
let activity: AgentActivity | undefined;
let activityRevision = 0;
function activityState(): AgentActivity {
  return (
    activity ?? {
      revision: activityRevision,
      status: working ? 'working' : 'idle',
      mainWorking: working,
      runningTasks: [],
      needsInputTasks: [],
      latestCompletion: null,
    }
  );
}
let failNextSend = false;
let holdNextHistory = false;
let historyRequests = 0;
let holdNextSend = false;
let releasePersistence: (() => void) | undefined;
let releaseAcceptance: (() => void) | undefined;
let releaseHistory: (() => void) | undefined;
let submissions: {
  text: string;
  idempotencyKey: string;
  attachmentIds: string[];
  taskId?: string;
  replyToMessageId?: string;
  destinationId: 'web';
  metadata: { timezone: string };
}[] = [];
const streams = new Set<ServerResponse>();

function message(text: string, role: Message['role'] = 'assistant'): Message {
  sequence += 1;
  return {
    id: `message-${sequence}`,
    source: role === 'user' ? 'web' : null,
    originDestinationId: role === 'user' ? 'web' : null,
    mainVisible: false,
    reaction: null,
    deliveryDestinationIds: [],
    notificationDestinationIds: [],
    notify: role === 'assistant',
    version: 1,
    idempotencyKey: null,
    replyToMessageId: null,
    replyTo: null,
    sequence,
    createdAt: '2026-10-06T08:00:00.000Z',
    updatedAt: '2026-10-06T08:00:00.000Z',
    role,
    text,
    metadata: {},
    taskId: null,
    phase: role === 'assistant' ? 'final_answer' : null,
    attachments: [],
    actions: null,
  };
}
function emit(event: string, data: object) {
  if (event === 'agent.activity' && 'state' in data) {
    const state = data.state as Partial<AgentActivity>;
    activityRevision++;
    activity = {
      revision: activityRevision,
      mainWorking: state.status === 'working',
      runningTasks: [],
      needsInputTasks: [],
      latestCompletion: null,
      ...state,
    } as AgentActivity;
    data = { event, state: activity };
  }
  for (const stream of streams)
    stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function publish(row: Message) {
  const index = rows.findIndex((current) => current.id === row.id);
  if (index === -1) rows.push(row);
  else rows[index] = row;
  const event = index === -1 ? 'message.added' : 'message.updated';
  emit(event, { event, message: row });
}
function json(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/instance-settings') {
    if (request.method === 'PATCH') {
      let body = '';
      for await (const chunk of request) body += chunk;
      instanceSettings = {
        ...instanceSettings,
        ...JSON.parse(body),
        version: instanceSettings.version + 1,
      };
      emit('instance.settings.updated', { event: 'instance.settings.updated' });
    }
    json(response, 200, instanceSettings);
    return;
  }
  if (url.pathname === '/stream') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    response.write('retry: 500\n\n');
    streams.add(response);
    response.write(
      `event: agent.activity\ndata: ${JSON.stringify({ event: 'agent.activity', state: activityState() })}\n\n`,
    );
    request.on('close', () => streams.delete(response));
    return;
  }
  if (url.pathname === '/tasks') {
    const eligible = taskRows.filter(
      (task) => task.archived === (url.searchParams.get('archived') === 'true'),
    );
    json(response, 200, { tasks: eligible, after: null });
    return;
  }
  if (url.pathname.startsWith('/tasks/details/')) {
    const task = taskRows.find(
      (task) => task.id === url.pathname.split('/').at(-1),
    );
    json(
      response,
      task ? 200 : 404,
      task ? { task } : { message: 'Not found' },
    );
    return;
  }
  if (
    request.method === 'POST' &&
    url.pathname.startsWith('/tasks/') &&
    url.pathname.endsWith('/archive')
  ) {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { archived } = JSON.parse(body) as { archived: boolean };
    const index = taskRows.findIndex(
      (task) => task.id === url.pathname.split('/')[2],
    );
    taskRows[index] = {
      ...taskRows[index]!,
      archived,
      version: taskRows[index]!.version + 1,
    };
    emit('task.updated', { event: 'task.updated', task: taskRows[index] });
    json(response, 201, {});
    return;
  }
  if (url.pathname === '/chat/history') {
    historyRequests += 1;
    const cursor = Number(url.searchParams.get('before') ?? Infinity);
    const limit = Number(url.searchParams.get('limit'));
    const eligible = rows
      .filter(
        (row) =>
          row.sequence < cursor &&
          (url.searchParams.has('taskId')
            ? row.taskId === url.searchParams.get('taskId')
            : row.taskId === null || row.mainVisible),
      )
      .sort((a, b) => b.sequence - a.sequence);
    const page = eligible.slice(0, limit);
    // Capture the snapshot before the test interleaves a newer live event.
    const payload = JSON.parse(
      JSON.stringify({
        messages: page,
        before: eligible.length > limit ? page.at(-1)?.sequence : null,
      }),
    ) as object;
    if (holdNextHistory) {
      holdNextHistory = false;
      releaseHistory = () => {
        json(response, 200, payload);
        releaseHistory = undefined;
      };
    } else json(response, 200, payload);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/chat/messages') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body) as (typeof submissions)[number];
    submissions.push(input);
    const replyTarget = rows.find((item) => item.id === input.replyToMessageId);
    const createdAt = new Date().toISOString();
    const existing = rows.find(
      (candidate) => candidate.idempotencyKey === input.idempotencyKey,
    );
    const row =
      existing ??
      ({
        ...message(input.text, 'user'),
        createdAt,
        updatedAt: createdAt,
        idempotencyKey: input.idempotencyKey,
        replyToMessageId: replyTarget?.id ?? null,
        replyTo: replyTarget
          ? {
              id: replyTarget.id,
              sequence: replyTarget.sequence,
              role: replyTarget.role,
              textPreview: replyTarget.text.slice(0, 160),
              taskId: replyTarget.taskId,
              phase: replyTarget.phase,
              mainVisible: false,
            }
          : null,
        taskId: input.taskId ?? null,
        phase: null,
        mainVisible: false,
        attachments: input.attachmentIds
          .map((id) => uploadedFiles.get(id)!)
          .filter(Boolean),
      } satisfies Message);
    if (!existing && input.text === 'Delegate tickets') {
      const task: TaskDetails = {
        id: 'ticket-task',
        title: 'F1 tickets',
        goal: 'Find Friday tickets',
        description: 'Look for Friday tickets.',
        status: 'in-progress',
        archived: false,
        version: 1,
        createdAt: '2026-10-06T08:00:00.000Z',
        updatedAt: '2026-10-06T08:00:00.000Z',
        lastActivityAt: '2026-10-06T08:00:00.000Z',
      };
      taskRows.push(task);
      emit('task.added', { event: 'task.added', task });
    }
    if (holdNextSend) {
      holdNextSend = false;
      await new Promise<void>((resolve) => {
        releasePersistence = resolve;
      });
      if (!existing) publish(row);
      await new Promise<void>((resolve) => {
        releaseAcceptance = resolve;
      });
    } else if (!existing) publish(row);
    if (failNextSend) {
      failNextSend = false;
      json(response, 503, {
        message:
          'Agent could not accept the message. Retry with the same idempotency key.',
      });
    } else {
      working = true;
      emit('agent.activity', {
        event: 'agent.activity',
        state: { status: 'working' },
      });
      json(response, 201, { messageId: row.id });
    }
    return;
  }
  json(response, 404, { message: 'Not found' });
});

export const backend = {
  get rows() {
    return rows;
  },
  set rows(value: Message[]) {
    rows = value;
  },
  get uploadedFiles() {
    return uploadedFiles;
  },
  get taskRows() {
    return taskRows;
  },
  set taskRows(value: TaskDetails[]) {
    taskRows = value;
  },
  get working() {
    return working;
  },
  set working(value: boolean) {
    working = value;
  },
  get failNextSend() {
    return failNextSend;
  },
  set failNextSend(value: boolean) {
    failNextSend = value;
  },
  get holdNextHistory() {
    return holdNextHistory;
  },
  set holdNextHistory(value: boolean) {
    holdNextHistory = value;
  },
  get historyRequests() {
    return historyRequests;
  },
  get holdNextSend() {
    return holdNextSend;
  },
  set holdNextSend(value: boolean) {
    holdNextSend = value;
  },
  get releasePersistence() {
    return releasePersistence;
  },
  set releasePersistence(value: (() => void) | undefined) {
    releasePersistence = value;
  },
  get releaseAcceptance() {
    return releaseAcceptance;
  },
  set releaseAcceptance(value: (() => void) | undefined) {
    releaseAcceptance = value;
  },
  get releaseHistory() {
    return releaseHistory;
  },
  set releaseHistory(value: (() => void) | undefined) {
    releaseHistory = value;
  },
  get submissions() {
    return submissions;
  },
  get streams() {
    return streams;
  },
  message,
  emit,
  publish,
};

export function usePalBackend(test: typeof playwrightTest) {
  test.beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(16991, '127.0.0.1', resolve),
    );
  });
  test.beforeEach(() => {
    for (const stream of streams) stream.end();
    streams.clear();
    rows = [];
    instanceSettings = defaultSettings();
    taskRows = [];
    sequence = 0;
    working = false;
    activity = undefined;
    activityRevision = 0;
    failNextSend = false;
    holdNextHistory = false;
    historyRequests = 0;
    holdNextSend = false;
    releasePersistence = undefined;
    releaseAcceptance = undefined;
    releaseHistory = undefined;
    submissions = [];
    uploadedFiles.clear();
  });
  test.afterAll(async () => {
    for (const stream of streams) stream.end();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
}

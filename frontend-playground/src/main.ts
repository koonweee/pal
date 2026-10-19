import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  getHistory,
  RequestError,
  sendMessage,
  getTasks,
  getTask,
  archiveTask,
} from './api';
import type { Message, ReplySummary, Task, TaskDetails } from './api';
import { PendingFiles, renderAttachments } from './attachments';
import './theme';
import './desktop';
import './mcp-settings';
import { configurePreferences } from './preferences';
import { closeThreadSidebar } from './thread-sidebar';

function inMainChat(message: Message) {
  return (
    message.taskId === null ||
    (message.role === 'assistant' && message.phase === 'final_answer')
  );
}
function quoteVisible(target: ReplySummary, taskId?: string) {
  return taskId
    ? target.taskId === taskId
    : target.taskId === null ||
        (target.role === 'assistant' && target.phase === 'final_answer');
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const history = element<HTMLDivElement>('history');
const messages = element<HTMLDivElement>('messages');
const draft = element<HTMLTextAreaElement>('draft');
const send = element<HTMLButtonElement>('send');
const older = element<HTMLButtonElement>('older');
const latest = element<HTMLButtonElement>('latest');
const connection = element<HTMLSpanElement>('connection');
const activity = element<HTMLSpanElement>('activity');
const composerStatus = element<HTMLSpanElement>('composer-status');
const historyError = element<HTMLDivElement>('history-error');
const sendError = element<HTMLDivElement>('send-error');
const restore = element<HTMLButtonElement>('restore');
const composerReply = element<HTMLDivElement>('composer-reply');
const fileInput = element<HTMLInputElement>('file-input');
const attachFiles = element<HTMLButtonElement>('attach-files');
const pendingFiles = new PendingFiles(element('pending-files'), updateControls);

let stored = new Map<string, Message>();
const outgoing = new Map<string, Message>();
let before: number | null = null;
let connected = false;
let opened = false;
let working = false;
let loaded = false;
let submitting = false;
let loadingOlder = false;
let syncing = false;
let generation = 0;
let snapshot: AbortController | undefined;
let buffered: Message[] = [];
let failedText = '';
let selectedReply: Message | undefined;
const chatReplies = new Map<string, Message | undefined>();
let messageNavigation = 0;

function renderComposerReply() {
  composerReply.hidden = !selectedReply;
  if (!selectedReply) return;
  element('composer-reply-role').textContent =
    selectedReply.role === 'user' ? 'You' : 'Pal';
  element('composer-reply-text').textContent =
    selectedReply.text.slice(0, 160) || 'Message';
}
function selectReply(message: Message) {
  if (submitting || !stored.has(message.id)) return;
  selectedReply = message;
  renderComposerReply();
  draft.focus();
}
async function navigateToMessage(id: string, taskId = selectedTaskId) {
  selectChat(taskId);
  const navigation = ++messageNavigation;
  while (
    taskId === selectedTaskId &&
    navigation === messageNavigation &&
    !stored.has(id)
  ) {
    if (loadingOlder || syncing)
      await new Promise((resolve) => setTimeout(resolve, 50));
    else if (before !== null) await loadOlder();
    else break;
    if (historyError.hidden === false) return;
  }
  if (taskId !== selectedTaskId || navigation !== messageNavigation) return;
  const target = Array.from(messages.children).find(
    (node) => node.getAttribute('data-message-id') === id,
  );
  if (!(target instanceof HTMLElement)) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('quote-highlight');
  setTimeout(() => target.classList.remove('quote-highlight'), 1800);
}

configurePreferences({ navigateToMessage });

const taskRows = new Map<string, Task>();
const taskDrafts = new Map<string, string>();
let selectedTaskId: string | undefined;
let selectedDetails: TaskDetails | undefined;
let taskArchived = false;
let taskAfter: string | null = null;
let taskPages = 1;
let taskGeneration = 0;
let taskSyncing = false;
let taskReadFailed = false;
let taskLoadingMore = false;
let taskBuffered: Task[] = [];
let taskSnapshot: AbortController | undefined;

// Each independent snapshot retries with backoff; newer reads cancel old timers.
function readRetry(read: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 2000;
  return {
    cancel(reset = false) {
      clearTimeout(timer);
      timer = undefined;
      if (reset) delay = 2000;
    },
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => void read(), delay);
      delay = Math.min(delay * 2, 30_000);
    },
  };
}
const historyRetry = readRetry(synchronize);
const tasksRetry = readRetry(synchronizeTasks);
const detailsRetry = readRetry(refreshTaskDetails);
let detailsGeneration = 0;
let detailsSnapshot: AbortController | undefined;

function mergeTask(task: Task) {
  const current = taskRows.get(task.id);
  if (!current || task.version > current.version) taskRows.set(task.id, task);
}
function renderTasks() {
  const fragment = document.createDocumentFragment();
  const list = element('task-list');
  for (const task of Array.from(taskRows.values())
    .filter((t) => t.archived === taskArchived)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'task-link';
    button.dataset.taskId = task.id;
    button.setAttribute('aria-current', String(task.id === selectedTaskId));
    button.disabled = submitting;
    const title = document.createElement('strong');
    title.textContent = task.title;
    const status = document.createElement('span');
    status.textContent = task.status;
    button.append(title, status);
    button.addEventListener('click', () => selectChat(task.id));
    fragment.append(button);
  }
  list.replaceChildren(fragment);
  element<HTMLButtonElement>('main-chat').disabled = submitting;
  element('main-chat').setAttribute('aria-current', String(!selectedTaskId));
  const more = element<HTMLButtonElement>('more-tasks');
  more.hidden = taskAfter === null;
  more.disabled = taskSyncing || taskLoadingMore || !connected;
  more.textContent = taskLoadingMore ? 'Loading…' : 'Load more tasks';
  element('task-list-empty').hidden = list.childElementCount > 0;
  renderTaskHeading();
}
function renderTaskHeading() {
  const task = selectedTaskId ? taskRows.get(selectedTaskId) : undefined;
  const title = task?.title ?? (selectedTaskId ? 'Task' : 'Main');
  element('chat-title').textContent = title;
  element('selected-thread').textContent = title;
  element('thread-open').setAttribute('aria-label', 'Select thread: ' + title);
  element('chat-description').textContent =
    task?.goal ?? 'Your conversation with Pal.';
  element('task-description').textContent = selectedDetails?.description ?? '';
  element('task-description').hidden =
    !selectedTaskId || !selectedDetails?.description;
  const status = element('task-status');
  status.hidden = !selectedTaskId;
  status.textContent = task?.status ?? '';
  const archive = element<HTMLButtonElement>('archive-task');
  archive.hidden = !task;
  archive.textContent = task?.archived ? 'Unarchive' : 'Archive';
  archive.disabled = !connected || taskSyncing;
  draft.placeholder = selectedTaskId ? 'Message this task…' : 'Message Pal…';
}
async function refreshTaskDetails() {
  detailsRetry.cancel();
  detailsSnapshot?.abort();
  const current = ++detailsGeneration;
  const id = selectedTaskId;
  if (!id) {
    if (!taskReadFailed) element('tasks-error').hidden = true;
    return;
  }
  try {
    const controller = new AbortController();
    detailsSnapshot = controller;
    const { task } = await getTask(id, controller.signal);
    if (current !== detailsGeneration) return;
    detailsRetry.cancel(true);
    if (!taskReadFailed) element('tasks-error').hidden = true;
    mergeTask(task);
    if (!selectedDetails || task.version >= selectedDetails.version)
      selectedDetails = task;
    renderTasks();
  } catch (error) {
    if (current !== detailsGeneration) return;
    showTaskError(error, true);
    detailsRetry.schedule();
  }
}
function selectChat(id?: string) {
  if (submitting) return;
  closeThreadSidebar();
  if (id === selectedTaskId) return;
  messageNavigation++;
  chatReplies.set(selectedTaskId ?? 'main', selectedReply);
  selectedReply = chatReplies.get(id ?? 'main');
  renderComposerReply();
  taskDrafts.set(selectedTaskId ?? 'main', draft.value);
  snapshot?.abort();
  historyRetry.cancel(true);
  detailsRetry.cancel(true);
  selectedTaskId = id;
  pendingFiles.setChat(id ?? 'main');
  selectedDetails = undefined;
  stored.clear();
  buffered = [];
  loaded = false;
  before = null;
  loadingOlder = false;
  draft.value = taskDrafts.get(id ?? 'main') ?? '';
  failedText = '';
  sendError.hidden = true;
  resizeDraft();
  renderTasks();
  render('initial');
  void refreshTaskDetails();
  void synchronize();
}

function showTaskError(error: unknown, retrying = false) {
  const notice = element('tasks-error');
  notice.textContent = `Could not load or update tasks. ${error instanceof Error ? error.message : 'Please try again.'} ${retrying ? 'Retrying automatically…' : 'Please try the action again.'}`;
  notice.hidden = false;
}
async function synchronizeTasks() {
  tasksRetry.cancel();
  taskSnapshot?.abort();
  const current = ++taskGeneration;
  const controller = new AbortController();
  taskSnapshot = controller;
  const archived = taskArchived;
  taskSyncing = true;
  renderTasks();
  try {
    const fresh = new Map<string, Task>();
    let cursor: string | undefined;
    let next: string | null = null;
    for (let page = 0; page < taskPages; page++) {
      const result = await getTasks(archived, cursor, controller.signal);
      for (const task of result.tasks) fresh.set(task.id, task);
      next = result.after;
      if (!next) break;
      cursor = next;
    }
    if (current !== taskGeneration) return;
    for (const [id, task] of taskRows)
      if (task.archived === archived && !fresh.has(id)) taskRows.delete(id);
    for (const task of fresh.values()) mergeTask(task);
    for (const task of taskBuffered) mergeTask(task);
    taskBuffered = [];
    taskAfter = next;
    tasksRetry.cancel(true);
    taskReadFailed = false;
    element('tasks-error').hidden = true;
    void refreshTaskDetails();
  } catch (error) {
    if (current !== taskGeneration) return;
    for (const task of taskBuffered) mergeTask(task);
    taskBuffered = [];
    taskReadFailed = true;
    showTaskError(error, true);
    tasksRetry.schedule();
  } finally {
    if (current === taskGeneration) {
      taskSyncing = false;
      renderTasks();
    }
  }
}
async function loadMoreTasks() {
  if (!taskAfter || taskLoadingMore || taskSyncing) return;
  const current = taskGeneration;
  taskLoadingMore = true;
  renderTasks();
  try {
    const result = await getTasks(taskArchived, taskAfter);
    if (current !== taskGeneration) return;
    for (const task of result.tasks) mergeTask(task);
    taskAfter = result.after;
    taskPages++;
  } catch (error) {
    if (current === taskGeneration) showTaskError(error);
  } finally {
    taskLoadingMore = false;
    renderTasks();
  }
}
element('main-chat').addEventListener('click', () => selectChat());
element<HTMLInputElement>('archived-tasks').addEventListener(
  'change',
  (event) => {
    tasksRetry.cancel(true);
    taskArchived = (event.target as HTMLInputElement).checked;
    taskPages = 1;
    taskAfter = null;
    renderTasks();
    void synchronizeTasks();
  },
);
element('more-tasks').addEventListener('click', () => void loadMoreTasks());
element('archive-task').addEventListener('click', async () => {
  const task = selectedTaskId ? taskRows.get(selectedTaskId) : undefined;
  if (!task) return;
  const button = element<HTMLButtonElement>('archive-task');
  button.disabled = true;
  try {
    await archiveTask(task.id, !task.archived);
    await refreshTaskDetails();
    await synchronizeTasks();
  } catch (error) {
    showTaskError(error);
  } finally {
    renderTasks();
  }
});

function merge(target: Map<string, Message>, message: Message) {
  if (message.idempotencyKey) outgoing.delete(message.idempotencyKey);
  const visible = selectedTaskId
    ? message.taskId === selectedTaskId
    : inMainChat(message);
  if (!visible && !target.has(message.id)) return;
  const current = target.get(message.id);
  if (!current || message.version > current.version)
    target.set(message.id, message);
}

function nearBottom() {
  return history.scrollHeight - history.scrollTop - history.clientHeight < 100;
}

function updateJump() {
  const remaining =
    history.scrollHeight - history.clientHeight - history.scrollTop;
  history.style.setProperty(
    '--fade-top',
    `${Math.min(20, Math.max(0, history.scrollTop))}px`,
  );
  history.style.setProperty(
    '--fade-bottom',
    `${Math.min(20, Math.max(0, remaining))}px`,
  );
  latest.hidden = nearBottom() || messages.childElementCount === 0;
}

function resizeDraft() {
  draft.style.overflowY = 'hidden';
  draft.style.height = 'auto';
  const height = draft.scrollHeight;
  draft.style.height = `${Math.min(height, 180)}px`;
  draft.style.overflowY = height > 180 ? 'auto' : 'hidden';
}

function updateControls() {
  connection.textContent = connected
    ? 'Connected'
    : opened
      ? 'Reconnecting…'
      : 'Connecting…';
  connection.dataset.connected = String(connected);
  activity.textContent = !connected
    ? 'Waiting for connection'
    : working
      ? 'Working'
      : 'Idle';
  activity.dataset.working = String(connected && working);
  composerStatus.textContent = !connected
    ? 'Waiting for connection…'
    : syncing
      ? 'Syncing history…'
      : working
        ? 'Pal is working. You can send a follow-up.'
        : 'Ready when you are.';
  send.disabled =
    !connected ||
    !loaded ||
    syncing ||
    submitting ||
    pendingFiles.blocked ||
    (!draft.value.trim() && !pendingFiles.count);
  attachFiles.disabled = submitting;
  pendingFiles.setBusy(submitting);
  older.disabled = syncing || loadingOlder || !connected;
  older.hidden = before === null;
  older.textContent = loadingOlder ? 'Loading…' : 'Load older messages';
  renderTasks();
}

const messageSignatures = new WeakMap<HTMLElement, string>();
function createMessageArticle(message: Message) {
  const article = document.createElement('article');
  article.className = `message ${message.role}`;
  article.dataset.messageId = message.id;
  article.setAttribute('aria-label', message.role === 'user' ? 'You' : 'Pal');
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (message.replyTo && quoteVisible(message.replyTo, selectedTaskId)) {
    const quote = document.createElement('button');
    quote.type = 'button';
    quote.className = 'message-quote';
    quote.setAttribute('aria-label', 'View quoted message');
    const role = document.createElement('strong');
    role.textContent = message.replyTo.role === 'user' ? 'You' : 'Pal';
    const preview = document.createElement('span');
    preview.textContent = message.replyTo.textPreview || 'Message';
    quote.append(role, preview);
    quote.addEventListener(
      'click',
      () => void navigateToMessage(message.replyTo!.id),
    );
    bubble.append(quote);
  }
  const body = document.createElement('div');
  body.className = 'message-body';
  if (message.role === 'assistant') {
    body.innerHTML = DOMPurify.sanitize(
      marked.parse(message.text, { async: false }),
      {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['img'],
      },
    );
    for (const link of body.querySelectorAll('a')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  } else {
    body.classList.add('plain-text');
    body.textContent = message.text;
  }
  bubble.append(body);
  if (message.attachments.length)
    bubble.append(renderAttachments(message.attachments));
  article.append(bubble);
  if (stored.has(message.id)) {
    const reply = document.createElement('button');
    reply.type = 'button';
    reply.className = 'reply-action';
    reply.textContent = '↩';
    reply.title = 'Reply';
    reply.setAttribute(
      'aria-label',
      `Reply to ${message.role === 'user' ? 'your' : 'Pal’s'} message`,
    );
    reply.addEventListener('click', () => selectReply(message));
    article.append(reply);
  }
  return article;
}

function render(mode: 'update' | 'older' | 'initial' = 'update') {
  const bottom = nearBottom();
  const oldHeight = history.scrollHeight;
  const historyTop = history.getBoundingClientRect().top;
  const anchor = Array.from(messages.children).find(
    (node) => node.getBoundingClientRect().bottom > historyTop,
  );
  const anchorId = anchor?.getAttribute('data-message-id');
  const anchorOffset = anchor?.getBoundingClientRect().top;
  const visible = [...stored.values(), ...outgoing.values()]
    .filter((message) =>
      selectedTaskId ? message.taskId === selectedTaskId : inMainChat(message),
    )
    .sort((a, b) => a.sequence - b.sequence);
  const latestUser = visible.findLast((message) => message.role === 'user');
  const existing = new Map(
    Array.from(messages.children, (node) => [
      (node as HTMLElement).dataset.messageId,
      node as HTMLElement,
    ]),
  );
  const articles: HTMLElement[] = [];
  for (const message of visible) {
    const signature = JSON.stringify([
      message,
      stored.has(message.id),
      message.replyTo && quoteVisible(message.replyTo, selectedTaskId),
    ]);
    let article = existing.get(message.id);
    if (!article || messageSignatures.get(article) !== signature) {
      article = createMessageArticle(message);
      messageSignatures.set(article, signature);
    }
    if (
      message.id === latestUser?.id &&
      !outgoing.has(message.idempotencyKey ?? '')
    ) {
      if (!article.querySelector('.message-read')) {
        const receipt = document.createElement('div');
        receipt.className = 'message-read';
        const time = document.createElement('time');
        time.dateTime = message.createdAt;
        time.textContent = new Date(message.createdAt).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        });
        time.title = new Date(message.createdAt).toLocaleString();
        receipt.append('Read ', time);
        article.append(receipt);
      }
    } else article.querySelector('.message-read')?.remove();
    articles.push(article);
  }
  const retained = new Set(articles);
  for (const node of Array.from(messages.children))
    if (!retained.has(node as HTMLElement)) node.remove();
  let cursor = messages.firstChild;
  for (const article of articles) {
    if (article !== cursor) messages.insertBefore(article, cursor);
    cursor = article.nextSibling;
  }
  element('empty').hidden = visible.length > 0;
  element('empty-detail').textContent = loaded
    ? 'Ask a question, share an idea, or pick up where you left off.'
    : connected
      ? 'Loading your conversation…'
      : 'Connecting to your conversation…';
  if (mode === 'initial' || (bottom && mode !== 'older')) {
    history.scrollTop = history.scrollHeight;
  } else if (anchorId && anchorOffset !== undefined) {
    const newAnchor = Array.from(messages.children).find(
      (node) => node.getAttribute('data-message-id') === anchorId,
    );
    if (newAnchor)
      history.scrollTop += newAnchor.getBoundingClientRect().top - anchorOffset;
  } else if (mode === 'older') {
    history.scrollTop += history.scrollHeight - oldHeight;
  }
  updateControls();
  updateJump();
}

async function synchronize() {
  historyRetry.cancel();
  snapshot?.abort();
  const current = ++generation;
  const controller = new AbortController();
  snapshot = controller;
  syncing = true;
  updateControls();
  // Refetch the entire displayed range: SSE has no event replay, and older
  // cached pages can change or leave Main while the connection is down.
  const oldest =
    loaded && stored.size
      ? Math.min(
          ...Array.from(stored.values())
            .filter((message) =>
              selectedTaskId
                ? message.taskId === selectedTaskId
                : inMainChat(message),
            )
            .map((message) => message.sequence),
        )
      : undefined;
  try {
    const fresh = new Map<string, Message>();
    let page = await getHistory(
      undefined,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      selectedTaskId,
    );
    for (const message of page.messages) merge(fresh, message);
    while (
      oldest !== undefined &&
      page.before !== null &&
      page.before > oldest
    ) {
      page = await getHistory(
        page.before,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        selectedTaskId,
      );
      for (const message of page.messages) merge(fresh, message);
    }
    if (current !== generation) return;
    for (const message of buffered) merge(fresh, message);
    buffered = [];
    // A page can straddle the old boundary after new messages arrive. Keep
    // the displayed range stable and leave the remaining rows for Load older.
    const crossedBoundary =
      oldest !== undefined &&
      Array.from(fresh.values()).some((message) => message.sequence < oldest);
    if (oldest !== undefined) {
      for (const [id, message] of fresh) {
        if (message.sequence < oldest) fresh.delete(id);
      }
    }
    stored = fresh;
    before = crossedBoundary && oldest !== undefined ? oldest : page.before;
    const initial = !loaded;
    loaded = true;
    historyError.hidden = true;
    historyRetry.cancel(true);
    syncing = false;
    render(initial ? 'initial' : 'update');
  } catch (error) {
    if (current !== generation) return;
    for (const message of buffered) merge(stored, message);
    buffered = [];
    syncing = false;
    historyError.textContent = `Could not refresh history. ${error instanceof Error ? error.message : 'Please try again.'} Retrying automatically…`;
    historyError.hidden = false;
    historyRetry.schedule();
    render();
  }
}

async function loadOlder() {
  if (before === null || loadingOlder || syncing) return;
  const current = generation;
  const cursor = before;
  loadingOlder = true;
  updateControls();
  try {
    const page = await getHistory(cursor, undefined, selectedTaskId);
    if (current !== generation) return;
    for (const message of page.messages) merge(stored, message);
    before = page.before;
    historyError.hidden = true;
    render('older');
  } catch (error) {
    if (current !== generation) return;
    historyError.textContent = `Could not load older messages. ${error instanceof Error ? error.message : 'Please try again.'}`;
    historyError.hidden = false;
  } finally {
    loadingOlder = false;
    updateControls();
  }
}

const stream = new EventSource('/api/stream');
stream.onopen = () => {
  connected = true;
  opened = true;
  working = false;
  void synchronize();
  void synchronizeTasks();
};
stream.onerror = () => {
  connected = false;
  updateControls();
};
for (const type of ['message.added', 'message.updated']) {
  stream.addEventListener(type, (event: MessageEvent<string>) => {
    const { message } = JSON.parse(event.data) as { message: Message };
    if (syncing) buffered.push(message);
    else {
      merge(stored, message);
      render();
    }
  });
}
stream.addEventListener('agent.activity', (event: MessageEvent<string>) => {
  const { state } = JSON.parse(event.data) as {
    state: { status: 'working' | 'idle' };
  };
  working = state.status === 'working';
  updateControls();
});

for (const type of ['task.added', 'task.updated']) {
  stream.addEventListener(type, (event: MessageEvent<string>) => {
    const { task } = JSON.parse(event.data) as { task: Task };
    if (taskSyncing) taskBuffered.push(task);
    mergeTask(task);
    renderTasks();
    if (
      task.id === selectedTaskId &&
      (!selectedDetails || task.version > selectedDetails.version)
    )
      void refreshTaskDetails();
  });
}

async function submit() {
  if (send.disabled) return;
  const text = draft.value;
  const attachments = pendingFiles.attachments;
  const destination = selectedTaskId;
  const idempotencyKey = crypto.randomUUID();
  const reply = selectedReply;
  outgoing.set(idempotencyKey, {
    source: 'web',
    originDestinationId: 'web',
    participantDestinationIds: [],
    deliveryDestinationIds: [],
    notificationDestinationIds: [],
    notify: false,
    id: 'local-' + idempotencyKey,
    idempotencyKey,
    replyToMessageId: reply?.id ?? null,
    replyTo: reply
      ? {
          id: reply.id,
          sequence: reply.sequence,
          role: reply.role,
          textPreview: reply.text.slice(0, 160),
          taskId: reply.taskId,
          phase: reply.phase,
        }
      : null,
    version: 0,
    sequence: Number.MAX_SAFE_INTEGER,
    createdAt: new Date().toISOString(),
    role: 'user',
    text,
    taskId: selectedTaskId ?? null,
    phase: null,
    attachments,
  });
  submitting = true;
  sendError.hidden = true;
  failedText = '';
  updateControls();
  render();
  try {
    await sendMessage(
      text,
      idempotencyKey,
      destination,
      reply?.id,
      attachments.map((file) => file.id),
    );
    pendingFiles.clear(destination ?? 'main');
    if (outgoing.has(idempotencyKey)) await synchronize();
    if (draft.value === text) {
      draft.value = '';
      resizeDraft();
    }
    if (selectedReply?.id === reply?.id) {
      selectedReply = undefined;
      renderComposerReply();
    }
  } catch (error) {
    outgoing.delete(idempotencyKey);
    render();
    failedText = text;
    const uncertain = !(error instanceof RequestError) || error.status >= 500;
    element('send-error-text').textContent =
      `Could not send. ${error instanceof Error ? error.message : 'Please try again.'}${
        uncertain
          ? ' Your message may already be saved. Sending again creates a new submission.'
          : ''
      }`;
    restore.hidden = draft.value === text;
    sendError.hidden = false;
    // Recover a persisted user message even when the handoff or HTTP response failed.
    void synchronize();
  } finally {
    submitting = false;
    updateControls();
    draft.focus();
  }
}

attachFiles.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  pendingFiles.add(Array.from(fileInput.files ?? []));
  fileInput.value = '';
});
draft.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length && !submitting) {
    event.preventDefault();
    pendingFiles.add(files);
  }
});
const chatPane = document.querySelector<HTMLElement>('.chat-pane')!;
chatPane.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files') && !submitting) {
    event.preventDefault();
    chatPane.classList.add('file-drag-over');
  }
});
chatPane.addEventListener('dragleave', (event) => {
  if (
    !(event.relatedTarget instanceof Node) ||
    !chatPane.contains(event.relatedTarget)
  )
    chatPane.classList.remove('file-drag-over');
});
chatPane.addEventListener('drop', (event) => {
  chatPane.classList.remove('file-drag-over');
  if (event.dataTransfer?.files.length) {
    event.preventDefault();
    pendingFiles.add(Array.from(event.dataTransfer.files));
  }
});

element<HTMLFormElement>('composer').addEventListener('submit', (event) => {
  event.preventDefault();
  void submit();
});
element('cancel-reply').addEventListener('click', () => {
  selectedReply = undefined;
  renderComposerReply();
  draft.focus();
});
draft.addEventListener('input', () => {
  resizeDraft();
  updateControls();
});
draft.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submit();
  }
});
older.addEventListener('click', () => void loadOlder());
element('dismiss').addEventListener('click', () => {
  sendError.hidden = true;
});
restore.addEventListener('click', () => {
  draft.value = draft.value ? `${draft.value}\n\n${failedText}` : failedText;
  restore.hidden = true;
  resizeDraft();
  updateControls();
  draft.focus();
});
window.addEventListener('resize', resizeDraft);
history.addEventListener('scroll', updateJump);
const historyResize = new ResizeObserver(updateJump);
historyResize.observe(history);
historyResize.observe(messages);
latest.addEventListener('click', () => {
  history.scrollTop = history.scrollHeight;
  updateJump();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && connected) {
    void synchronize();
    void synchronizeTasks();
  }
});
resizeDraft();
updateControls();

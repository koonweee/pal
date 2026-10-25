import { useLayoutEffect, useMemo, useState } from 'react';
import type { PendingFile } from '../attachments/use-pending-files';
import type { ChatController } from '../chat/use-chat';
import { PlaygroundShellView } from '../PlaygroundShell';
import {
  workbenchMcpPreview,
  workbenchMessages,
  workbenchPreferencePreview,
  workbenchTaskDetails,
  workbenchTasks,
} from './workbench-fixtures';

export const workbenchDevices = {
  macbookAir: {
    height: 832,
    label: 'MacBook Air',
    touch: false,
    width: 1280,
  },
  iphone17: {
    height: 874,
    label: 'iPhone 17',
    touch: true,
    width: 402,
  },
  ipadMini: {
    height: 1133,
    label: 'iPad mini',
    touch: true,
    width: 744,
  },
} as const;

export type WorkbenchDevice = keyof typeof workbenchDevices;
export type ConversationScene =
  | 'messages'
  | 'empty'
  | 'loading'
  | 'working'
  | 'offline'
  | 'error';
export type ComposerScene = 'ready' | 'reply' | 'files' | 'error';
export type TaskScene = 'populated' | 'empty' | 'error' | 'loading';

const conversationScenes: ConversationScene[] = [
  'messages',
  'empty',
  'loading',
  'working',
  'offline',
  'error',
];
const composerScenes: ComposerScene[] = ['ready', 'reply', 'files', 'error'];
const taskScenes: TaskScene[] = ['populated', 'empty', 'error', 'loading'];

function option<T extends string>(
  query: URLSearchParams,
  name: string,
  values: T[],
  fallback: T,
) {
  const value = query.get(name) as T | null;
  return value && values.includes(value) ? value : fallback;
}

function useWorkbenchChat(
  conversationScene: ConversationScene,
  composerScene: ComposerScene,
  taskScene: TaskScene,
) {
  const [draft, setDraft] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedReply, setSelectedReply] = useState(
    composerScene === 'reply' ? workbenchMessages[1]!.message : undefined,
  );
  const [failureState, setFailureState] = useState<
    'failed' | 'retrying' | 'sent' | 'dismissed'
  >(composerScene === 'error' ? 'failed' : 'sent');
  const files = useMemo<PendingFile[]>(
    () => [
      {
        file: new File(['brief'], 'launch-brief.pdf', {
          type: 'application/pdf',
        }),
        id: 'pending-ready',
        state: 'ready',
      },
      {
        file: new File(['notes'], 'notes.txt', { type: 'text/plain' }),
        id: 'pending-uploading',
        state: 'uploading',
      },
      {
        error: 'Upload failed',
        file: new File(['large'], 'research.zip', {
          type: 'application/zip',
        }),
        id: 'pending-failed',
        state: 'failed',
      },
    ],
    [],
  );
  const pendingEntries = composerScene === 'files' ? files : [];
  const tasks = taskScene === 'empty' ? [] : workbenchTasks;
  const taskRows = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const messages = ['empty', 'loading'].includes(conversationScene)
    ? []
    : workbenchMessages
        .filter(
          (_, index) =>
            failureState !== 'dismissed' ||
            index !== workbenchMessages.length - 1,
        )
        .map((view, index) =>
          index === workbenchMessages.length - 1 &&
          (failureState === 'failed' || failureState === 'retrying')
            ? {
                ...view,
                failed: true,
                receiptSlot: false,
                retrying: failureState === 'retrying',
              }
            : view,
        );
  const connected = conversationScene !== 'offline';
  const loaded = conversationScene !== 'loading';
  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId)
    : undefined;

  const chat: ChatController = {
    before: messages.length ? 1 : null,
    canSend:
      connected &&
      loaded &&
      (!!draft.trim() ||
        (!!pendingEntries.length &&
          pendingEntries.every((entry) => entry.state === 'ready'))),
    clearNavigationTarget() {},
    connected,
    dismissFailedMessage() {
      setFailureState('dismissed');
    },
    draft,
    failedSends: new Map(),
    async ensureMessage() {
      return true;
    },
    historyError:
      conversationScene === 'error'
        ? 'Could not refresh history. Retrying automatically…'
        : undefined,
    loaded,
    hiddenMessageKeys: new Set(),
    async loadMoreTasks() {},
    async loadOlder() {},
    loadingOlder: false,
    localSendKey: undefined,
    messages,
    opened: true,
    async synchronize() {},
    openMainLatest() {
      setSelectedTaskId(undefined);
      return true;
    },
    online: conversationScene !== 'offline',
    outgoing: new Map(),
    pendingFiles: {
      add() {},
      attachments: [],
      blocked: pendingEntries.some((entry) => entry.state !== 'ready'),
      clear() {},
      count: pendingEntries.length,
      entries: pendingEntries,
      error: undefined,
      remove() {},
      retry() {},
    },
    selectedDetails:
      selectedTaskId === workbenchTaskDetails.id
        ? workbenchTaskDetails
        : undefined,
    selectedReply:
      composerScene === 'reply'
        ? (selectedReply ?? workbenchMessages[1]!.message)
        : undefined,
    selectedTask,
    selectedTaskId,
    selectChat(id) {
      setSelectedTaskId(id);
    },
    selectSuggestedReply() {},
    selectReply(message) {
      setSelectedReply(message);
    },
    retryingSendKey:
      failureState === 'retrying'
        ? (workbenchMessages.at(-1)?.message.idempotencyKey ?? undefined)
        : undefined,
    async retryFailedMessage() {
      setFailureState('retrying');
      await Promise.resolve();
      setFailureState('sent');
    },
    setDraft,
    setTaskArchived() {},
    stored: new Map(
      workbenchMessages.map(({ message }) => [message.id, message]),
    ),
    submitting: failureState === 'retrying',
    async submit() {
      setDraft('');
    },
    syncing: conversationScene === 'loading',
    taskAfter: taskScene === 'populated' ? 'next-page' : null,
    taskArchived: false,
    taskError:
      taskScene === 'error'
        ? 'Could not load or update tasks. Retrying automatically…'
        : undefined,
    taskLoadingMore: taskScene === 'loading',
    taskPages: 1,
    taskRows,
    taskSyncing: taskScene === 'loading',
    tasks,
    typing: false,
    async toggleArchive() {},
    activity: {
      revision: 1,
      mainWorking: conversationScene === 'working',
      status: conversationScene === 'working' ? 'working' : 'idle',
      runningTasks: [],
      needsInputTasks: [],
      latestCompletion: null,
    },
  };
  return chat;
}

export function WorkbenchApplicationPreview() {
  const query = new URLSearchParams(location.search);
  const device = option(
    query,
    'device',
    Object.keys(workbenchDevices) as WorkbenchDevice[],
    'macbookAir',
  );
  const chat = useWorkbenchChat(
    option(query, 'conversation', conversationScenes, 'messages'),
    option(query, 'composer', composerScenes, 'ready'),
    option(query, 'tasks', taskScenes, 'populated'),
  );
  const touch = workbenchDevices[device].touch;

  useLayoutEffect(() => {
    document.documentElement.dataset.workbenchInput = touch
      ? 'touch'
      : 'pointer';
    return () => {
      delete document.documentElement.dataset.workbenchInput;
    };
  }, [touch]);

  return (
    <PlaygroundShellView
      chat={chat}
      preview={{
        preferences: workbenchPreferencePreview,
        services: workbenchMcpPreview,
      }}
    />
  );
}

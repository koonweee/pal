import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveTask,
  getHistory,
  getTask,
  getTasks,
  RequestError,
  sendMessage,
  type Message,
  type Task,
  type TaskDetails,
} from '../api/client';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { openPalEventStream } from '../api/events';
import { useAgentActivity } from '../activity/use-agent-activity';
import { usePendingFiles } from '../attachments/use-pending-files';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';
import {
  inMainChat,
  mergeMessage,
  quoteVisible,
  upsertVersion,
  visibleInChat,
  visibleMessages,
} from './sync';
import { useConversationPacing } from './use-conversation-pacing';

export interface MessageView {
  message: Message;
  persisted: boolean;
  receiptSlot: boolean;
  showQuote: boolean;
  read: boolean;
}

interface SendFailure {
  message: string;
  failedText: string;
  restore: boolean;
}

interface ChatState {
  before: number | null;
  connected: boolean;
  draft: string;
  loaded: boolean;
  navigationTarget?: { id: string; key: number };
  loadingOlder: boolean;
  localSendKey?: string;
  opened: boolean;
  latestNavigationKey?: number;
  online: boolean;
  outgoing: Map<string, Message>;
  selectedDetails?: TaskDetails;
  selectedReply?: Message;
  selectedTaskId?: string;
  stored: Map<string, Message>;
  submitting: boolean;
  syncing: boolean;
  historyError?: string;
  sendFailure?: SendFailure;
  taskAfter: string | null;
  taskArchived: boolean;
  taskError?: string;
  taskLoadingMore: boolean;
  taskPages: number;
  taskRows: Map<string, Task>;
  taskSyncing: boolean;
}

const initialState: ChatState = {
  before: null,
  connected: false,
  draft: '',
  loaded: false,
  loadingOlder: false,
  opened: false,
  online: navigator.onLine,
  outgoing: new Map(),
  stored: new Map(),
  submitting: false,
  syncing: false,
  taskAfter: null,
  taskArchived: false,
  taskLoadingMore: false,
  taskPages: 1,
  taskRows: new Map(),
  taskSyncing: false,
};

function retryController(read: () => void) {
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
      timer = setTimeout(read, delay);
      delay = Math.min(delay * 2, 30_000);
    },
  };
}

function latestAssistantSequence(
  stored: Map<string, Message>,
  selectedTaskId?: string,
) {
  let latest = -1;
  for (const message of stored.values())
    if (message.role === 'assistant' && visibleInChat(message, selectedTaskId))
      latest = Math.max(latest, message.sequence);
  return latest;
}

export function useChat() {
  const {
    snapshot: activity,
    clear: clearActivity,
    receive: receiveActivity,
  } = useAgentActivity();
  const { refresh: refreshInstanceSettings } = useInstanceSettings();
  const { update: updateReloadSafety } = useReloadSafety();
  const {
    activeMessageKey,
    assistantArrived,
    messageAccepted,
    messageFailed,
    messageSubmitted,
    messagesPersisted,
    receiptMessageKey,
    reset: resetPacing,
    typingVisible,
  } = useConversationPacing();
  const [state, setState] = useState(initialState);
  const current = useRef(state);
  const generation = useRef(0);
  const taskGeneration = useRef(0);
  const detailsGeneration = useRef(0);
  const snapshot = useRef<AbortController | undefined>(undefined);
  const taskSnapshot = useRef<AbortController | undefined>(undefined);
  const detailsSnapshot = useRef<AbortController | undefined>(undefined);
  const buffered = useRef<Message[]>([]);
  const taskBuffered = useRef<Task[]>([]);
  const taskDrafts = useRef(new Map<string, string>());
  const chatReplies = useRef(new Map<string, Message | undefined>());
  const mounted = useRef(true);
  const controller = useRef<{
    synchronize(): Promise<void>;
    synchronizeTasks(): Promise<void>;
    refreshTaskDetails(): Promise<void>;
  }>({
    synchronize: async () => undefined,
    synchronizeTasks: async () => undefined,
    refreshTaskDetails: async () => undefined,
  });
  const historyRetry = useRef(
    retryController(() => void controller.current.synchronize()),
  );
  const tasksRetry = useRef(
    retryController(() => void controller.current.synchronizeTasks()),
  );
  const detailsRetry = useRef(
    retryController(() => void controller.current.refreshTaskDetails()),
  );

  const commit = useCallback(
    (update: Partial<ChatState> | ((value: ChatState) => ChatState)) => {
      const next =
        typeof update === 'function'
          ? update(current.current)
          : { ...current.current, ...update };
      current.current = next;
      if (mounted.current) setState(next);
    },
    [],
  );

  const chatKey = state.selectedTaskId ?? 'main';
  const pendingFiles = usePendingFiles(chatKey);

  useEffect(() => {
    updateReloadSafety({
      draft: state.draft,
      pendingFiles: pendingFiles.count,
      submitting: state.submitting,
    });
  }, [pendingFiles.count, state.draft, state.submitting, updateReloadSafety]);

  const refreshTaskDetails = useCallback(async () => {
    detailsRetry.current.cancel();
    detailsSnapshot.current?.abort();
    const read = ++detailsGeneration.current;
    const id = current.current.selectedTaskId;
    if (!id) return;
    try {
      const abort = new AbortController();
      detailsSnapshot.current = abort;
      const { task } = await getTask(id, abort.signal);
      if (read !== detailsGeneration.current) return;
      detailsRetry.current.cancel(true);
      const taskRows = new Map(current.current.taskRows);
      upsertVersion(taskRows, task);
      commit((value) => ({
        ...value,
        taskRows,
        selectedDetails:
          !value.selectedDetails ||
          task.version >= value.selectedDetails.version
            ? task
            : value.selectedDetails,
      }));
    } catch (error) {
      if (read !== detailsGeneration.current) return;
      commit({
        taskError: `Could not load or update tasks. ${error instanceof Error ? error.message : 'Please try again.'} Retrying automatically…`,
      });
      detailsRetry.current.schedule();
    }
  }, [commit]);

  const synchronizeTasks = useCallback(async () => {
    tasksRetry.current.cancel();
    taskSnapshot.current?.abort();
    const read = ++taskGeneration.current;
    const abort = new AbortController();
    taskSnapshot.current = abort;
    const archived = current.current.taskArchived;
    commit({ taskSyncing: true });
    try {
      const fresh = new Map<string, Task>();
      let cursor: string | undefined;
      let after: string | null = null;
      for (let page = 0; page < current.current.taskPages; page++) {
        const result = await getTasks(archived, cursor, abort.signal);
        for (const task of result.tasks) fresh.set(task.id, task);
        after = result.after;
        if (!after) break;
        cursor = after;
      }
      if (read !== taskGeneration.current) return;
      const taskRows = new Map(current.current.taskRows);
      for (const [id, task] of taskRows)
        if (task.archived === archived && !fresh.has(id)) taskRows.delete(id);
      for (const task of fresh.values()) upsertVersion(taskRows, task);
      for (const task of taskBuffered.current) upsertVersion(taskRows, task);
      taskBuffered.current = [];
      tasksRetry.current.cancel(true);
      commit({
        taskAfter: after,
        taskError: undefined,
        taskRows,
        taskSyncing: false,
      });
      void controller.current.refreshTaskDetails();
    } catch (error) {
      if (read !== taskGeneration.current) return;
      const taskRows = new Map(current.current.taskRows);
      for (const task of taskBuffered.current) upsertVersion(taskRows, task);
      taskBuffered.current = [];
      commit({
        taskError: `Could not load or update tasks. ${error instanceof Error ? error.message : 'Please try again.'} Retrying automatically…`,
        taskRows,
        taskSyncing: false,
      });
      tasksRetry.current.schedule();
    }
  }, [commit]);

  const synchronize = useCallback(async () => {
    historyRetry.current.cancel();
    snapshot.current?.abort();
    const read = ++generation.current;
    const abort = new AbortController();
    snapshot.current = abort;
    const selectedTaskId = current.current.selectedTaskId;
    const original = current.current;
    commit({ syncing: true });
    const oldest =
      original.loaded && original.stored.size
        ? Math.min(
            ...Array.from(original.stored.values())
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
        AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
        selectedTaskId,
      );
      for (const message of page.messages)
        mergeMessage(fresh, message, selectedTaskId, current.current.outgoing);
      while (
        oldest !== undefined &&
        page.before !== null &&
        page.before > oldest
      ) {
        page = await getHistory(
          page.before,
          AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
          selectedTaskId,
        );
        for (const message of page.messages)
          mergeMessage(
            fresh,
            message,
            selectedTaskId,
            current.current.outgoing,
          );
      }
      if (read !== generation.current) return;
      for (const message of buffered.current)
        mergeMessage(fresh, message, selectedTaskId, current.current.outgoing);
      buffered.current = [];
      const crossedBoundary =
        oldest !== undefined &&
        Array.from(fresh.values()).some((message) => message.sequence < oldest);
      if (oldest !== undefined)
        for (const [id, message] of fresh)
          if (message.sequence < oldest) fresh.delete(id);
      historyRetry.current.cancel(true);
      commit({
        before: crossedBoundary && oldest !== undefined ? oldest : page.before,
        historyError: undefined,
        loaded: true,
        stored: fresh,
        syncing: false,
      });
    } catch (error) {
      if (read !== generation.current) return;
      const stored = new Map(current.current.stored);
      for (const message of buffered.current)
        mergeMessage(stored, message, selectedTaskId, current.current.outgoing);
      buffered.current = [];
      commit({
        historyError: `Could not refresh history. ${error instanceof Error ? error.message : 'Please try again.'} Retrying automatically…`,
        stored,
        syncing: false,
      });
      historyRetry.current.schedule();
    }
  }, [commit]);

  controller.current = {
    refreshTaskDetails,
    synchronize,
    synchronizeTasks,
  };

  const selectChat = useCallback(
    (id?: string) => {
      const value = current.current;
      if (value.submitting || id === value.selectedTaskId) return;
      resetPacing();
      chatReplies.current.set(
        value.selectedTaskId ?? 'main',
        value.selectedReply,
      );
      taskDrafts.current.set(value.selectedTaskId ?? 'main', value.draft);
      snapshot.current?.abort();
      historyRetry.current.cancel(true);
      detailsRetry.current.cancel(true);
      generation.current++;
      detailsGeneration.current++;
      buffered.current = [];
      commit({
        before: null,
        draft: taskDrafts.current.get(id ?? 'main') ?? '',
        historyError: undefined,
        loaded: false,
        loadingOlder: false,
        selectedDetails: undefined,
        selectedReply: chatReplies.current.get(id ?? 'main'),
        selectedTaskId: id,
        sendFailure: undefined,
        stored: new Map(),
      });
      void controller.current.refreshTaskDetails();
      void controller.current.synchronize();
    },
    [commit, resetPacing],
  );

  const loadOlder = useCallback(async () => {
    const value = current.current;
    if (value.before === null || value.loadingOlder || value.syncing) return;
    const read = generation.current;
    const cursor = value.before;
    commit({ loadingOlder: true });
    try {
      const page = await getHistory(cursor, undefined, value.selectedTaskId);
      if (read !== generation.current) return;
      const stored = new Map(current.current.stored);
      for (const message of page.messages)
        mergeMessage(
          stored,
          message,
          current.current.selectedTaskId,
          current.current.outgoing,
        );
      commit({ before: page.before, historyError: undefined, stored });
    } catch (error) {
      if (read !== generation.current) return;
      commit({
        historyError: `Could not load older messages. ${error instanceof Error ? error.message : 'Please try again.'}`,
      });
    } finally {
      if (read === generation.current) commit({ loadingOlder: false });
    }
  }, [commit]);

  const ensureMessage = useCallback(
    async (id: string, taskId?: string) => {
      selectChat(taskId);
      const destination = taskId;
      const navigation = generation.current;
      while (
        current.current.selectedTaskId === destination &&
        generation.current === navigation &&
        !current.current.stored.has(id)
      ) {
        if (current.current.loadingOlder || current.current.syncing)
          await new Promise((resolve) => setTimeout(resolve, 50));
        else if (current.current.before !== null) await loadOlder();
        else break;
        if (current.current.historyError) return false;
      }
      const found = current.current.stored.has(id);
      if (found)
        commit({ navigationTarget: { id, key: Date.now() + Math.random() } });
      return found;
    },
    [loadOlder, selectChat],
  );

  const submit = useCallback(async () => {
    const value = current.current;
    if (
      !value.connected ||
      !value.loaded ||
      value.syncing ||
      value.submitting ||
      pendingFiles.blocked ||
      (!value.draft.trim() && !pendingFiles.count)
    )
      return;
    const text = value.draft;
    const attachments = pendingFiles.attachments;
    const destination = value.selectedTaskId;
    const assistantSequence = latestAssistantSequence(
      value.stored,
      destination,
    );
    const idempotencyKey = crypto.randomUUID();
    const reply = value.selectedReply;
    const createdAt = new Date().toISOString();
    const outgoing = new Map(value.outgoing);
    outgoing.set(idempotencyKey, {
      source: 'web',
      originDestinationId: 'web',
      mainVisible: false,
      reaction: null,
      deliveryDestinationIds: [],
      notificationDestinationIds: [],
      notify: false,
      id: `local-${idempotencyKey}`,
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
            mainVisible: reply.mainVisible,
          }
        : null,
      version: 0,
      sequence: Number.MAX_SAFE_INTEGER,
      createdAt,
      updatedAt: createdAt,
      role: 'user',
      text,
      metadata: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      taskId: destination ?? null,
      phase: null,
      attachments,
      actions: null,
    });
    commit({
      localSendKey: idempotencyKey,
      outgoing,
      sendFailure: undefined,
      submitting: true,
    });
    messageSubmitted(idempotencyKey, assistantSequence);
    try {
      await sendMessage({
        text,
        idempotencyKey,
        taskId: destination,
        replyToMessageId: reply?.id,
        attachmentIds: attachments.map((file) => file.id),
      });
      messageAccepted(idempotencyKey);
      assistantArrived(
        latestAssistantSequence(current.current.stored, destination),
      );
      pendingFiles.clear(destination ?? 'main');
      if (current.current.outgoing.has(idempotencyKey))
        await controller.current.synchronize();
      commit((latest) => ({
        ...latest,
        draft: latest.draft === text ? '' : latest.draft,
        selectedReply:
          latest.selectedReply?.id === reply?.id
            ? undefined
            : latest.selectedReply,
      }));
    } catch (error) {
      messageFailed(idempotencyKey);
      const nextOutgoing = new Map(current.current.outgoing);
      nextOutgoing.delete(idempotencyKey);
      const uncertain = !(error instanceof RequestError) || error.status >= 500;
      commit({
        outgoing: nextOutgoing,
        sendFailure: {
          failedText: text,
          message: `Could not send. ${error instanceof Error ? error.message : 'Please try again.'}${
            uncertain
              ? ' Your message may already be saved. Sending again creates a new submission.'
              : ''
          }`,
          restore: current.current.draft !== text,
        },
      });
      void controller.current.synchronize();
    } finally {
      commit({ submitting: false });
    }
  }, [
    assistantArrived,
    commit,
    messageAccepted,
    messageFailed,
    messageSubmitted,
    pendingFiles,
  ]);

  const loadMoreTasks = useCallback(async () => {
    const value = current.current;
    if (!value.taskAfter || value.taskLoadingMore || value.taskSyncing) return;
    const read = taskGeneration.current;
    commit({ taskLoadingMore: true });
    try {
      const result = await getTasks(value.taskArchived, value.taskAfter);
      if (read !== taskGeneration.current) return;
      const taskRows = new Map(current.current.taskRows);
      for (const task of result.tasks) upsertVersion(taskRows, task);
      commit({
        taskAfter: result.after,
        taskPages: current.current.taskPages + 1,
        taskRows,
      });
    } catch (error) {
      if (read === taskGeneration.current)
        commit({
          taskError: `Could not load or update tasks. ${error instanceof Error ? error.message : 'Please try the action again.'}`,
        });
    } finally {
      if (read === taskGeneration.current) commit({ taskLoadingMore: false });
    }
  }, [commit]);

  const setTaskArchived = useCallback(
    (taskArchived: boolean) => {
      tasksRetry.current.cancel(true);
      commit({ taskAfter: null, taskArchived, taskPages: 1 });
      void controller.current.synchronizeTasks();
    },
    [commit],
  );

  const toggleArchive = useCallback(async () => {
    const value = current.current;
    const task = value.selectedTaskId
      ? value.taskRows.get(value.selectedTaskId)
      : undefined;
    if (!task) return;
    commit({ taskSyncing: true });
    try {
      await archiveTask(task.id, !task.archived);
      await controller.current.refreshTaskDetails();
      await controller.current.synchronizeTasks();
    } catch (error) {
      commit({
        taskError: `Could not load or update tasks. ${error instanceof Error ? error.message : 'Please try the action again.'}`,
        taskSyncing: false,
      });
    }
  }, [commit]);

  useEffect(() => {
    const online = () => {
      commit({ online: true });
      void controller.current.synchronize();
      void controller.current.synchronizeTasks();
      void refreshInstanceSettings();
    };
    const offline = () => commit({ online: false });
    const visible = () => {
      if (document.visibilityState === 'visible' && current.current.connected) {
        void controller.current.synchronize();
        void controller.current.synchronizeTasks();
        void refreshInstanceSettings();
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const close = openPalEventStream({
      onOpen() {
        clearActivity();
        commit({ connected: true, opened: true });
        void controller.current.synchronize();
        void controller.current.synchronizeTasks();
        void refreshInstanceSettings();
      },
      onError() {
        clearActivity();
        commit({ connected: false });
      },
      onMalformed() {
        void controller.current.synchronize();
        void controller.current.synchronizeTasks();
        void refreshInstanceSettings();
      },
      onEvent(event) {
        if (event.event === 'instance.settings.updated') {
          void refreshInstanceSettings();
          return;
        }
        if (
          event.event === 'message.added' ||
          event.event === 'message.updated'
        ) {
          if (
            event.message.role === 'assistant' &&
            visibleInChat(event.message, current.current.selectedTaskId)
          )
            assistantArrived(event.message.sequence);
          if (current.current.syncing) buffered.current.push(event.message);
          else {
            const stored = new Map(current.current.stored);
            const outgoing = new Map(current.current.outgoing);
            mergeMessage(
              stored,
              event.message,
              current.current.selectedTaskId,
              outgoing,
            );
            commit({ outgoing, stored });
          }
          return;
        }
        if (event.event === 'agent.activity') {
          receiveActivity(event.state);
          return;
        }
        if (event.event === 'task.added' || event.event === 'task.updated') {
          if (current.current.taskSyncing)
            taskBuffered.current.push(event.task);
          const taskRows = new Map(current.current.taskRows);
          upsertVersion(taskRows, event.task);
          commit({ taskRows });
          if (
            event.task.id === current.current.selectedTaskId &&
            (!current.current.selectedDetails ||
              event.task.version > current.current.selectedDetails.version)
          )
            void controller.current.refreshTaskDetails();
        }
      },
    });
    return () => {
      mounted.current = false;
      close();
      snapshot.current?.abort();
      taskSnapshot.current?.abort();
      detailsSnapshot.current?.abort();
      historyRetry.current.cancel();
      tasksRetry.current.cancel();
      detailsRetry.current.cancel();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [
    assistantArrived,
    clearActivity,
    commit,
    receiveActivity,
    refreshInstanceSettings,
  ]);

  useEffect(() => {
    messagesPersisted(
      new Set(
        Array.from(
          state.stored.values(),
          (message) => message.idempotencyKey,
        ).filter((key): key is string => !!key),
      ),
    );
    assistantArrived(
      latestAssistantSequence(state.stored, state.selectedTaskId),
    );
  }, [assistantArrived, messagesPersisted, state.selectedTaskId, state.stored]);

  const tasks = useMemo(
    () =>
      Array.from(state.taskRows.values())
        .filter((task) => task.archived === state.taskArchived)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        ),
    [state.taskArchived, state.taskRows],
  );
  const messages = useMemo(() => {
    const visible = visibleMessages(
      state.stored,
      state.outgoing,
      state.selectedTaskId,
    );
    const latestUser = visible.findLast((message) => message.role === 'user');
    return visible.map<MessageView>((message) => {
      const persisted = state.stored.has(message.id);
      const messageKey = message.idempotencyKey ?? message.id;
      const receiptSlot = message.id === latestUser?.id;
      return {
        message,
        persisted,
        receiptSlot,
        showQuote: !!(
          message.replyTo && quoteVisible(message.replyTo, state.selectedTaskId)
        ),
        read:
          receiptSlot &&
          persisted &&
          (activeMessageKey === undefined || receiptMessageKey === messageKey),
      };
    });
  }, [
    activeMessageKey,
    receiptMessageKey,
    state.outgoing,
    state.selectedTaskId,
    state.stored,
  ]);
  const selectedTask = state.selectedTaskId
    ? state.taskRows.get(state.selectedTaskId)
    : undefined;
  const canSend =
    state.connected &&
    state.loaded &&
    !state.syncing &&
    !state.submitting &&
    !pendingFiles.blocked &&
    (!!state.draft.trim() || !!pendingFiles.count);

  return {
    ...state,
    activity,
    canSend,
    ensureMessage,
    loadMoreTasks,
    loadOlder,
    messages,
    pendingFiles,
    selectedTask,
    selectChat,
    openMainLatest() {
      if (current.current.submitting) return false;
      const switching = current.current.selectedTaskId !== undefined;
      selectChat();
      commit({
        navigationTarget: undefined,
        latestNavigationKey: (current.current.latestNavigationKey ?? 0) + 1,
      });
      if (!switching) void controller.current.synchronize();
      return true;
    },
    selectReply(message?: Message) {
      if (
        !current.current.submitting &&
        (!message || current.current.stored.has(message.id))
      )
        commit({ selectedReply: message });
    },
    setDraft(draft: string) {
      commit({ draft });
    },
    setTaskArchived,
    submit,
    tasks,
    toggleArchive,
    typing: typingVisible,
    dismissSendFailure() {
      commit({ sendFailure: undefined });
    },
    clearNavigationTarget() {
      commit({ navigationTarget: undefined });
    },
    restoreFailedText() {
      const failure = current.current.sendFailure;
      if (!failure) return;
      commit({
        draft: current.current.draft
          ? `${current.current.draft}\n\n${failure.failedText}`
          : failure.failedText,
        sendFailure: { ...failure, restore: false },
      });
    },
  };
}

export type ChatController = ReturnType<typeof useChat>;

import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import {
  DatabaseService,
  type Transaction,
} from '../database/database.service.js';
import { FilesRepository } from '../files/files.repository.js';
import { TasksRepository, taskView } from '../tasks/tasks.repository.js';
import { EventsService } from '../events/events.service.js';
import { ChatRepository } from './chat.repository.js';
import { DestinationService } from '../delivery/destination.service.js';
import { DeliveryJobRepository } from '../delivery/delivery-job.repository.js';
import { NotificationRepository } from '../notifications/notification.repository.js';
import { parseSuggestedReplies } from './suggested-replies.js';
import type { SubmitMessageInput } from '../application/contracts/chat.js';
import type { ChatViewPort } from '../application/contracts/chat.js';
import type { PublishMessage } from './chat.types.js';
import { messageVisibleInChat } from './chat.types.js';
@Injectable()
export class ChatService implements ChatViewPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ChatRepository) private readonly repository: ChatRepository,
    @Inject(FilesRepository) private readonly files: FilesRepository,
    @Inject(TasksRepository) private readonly tasks: TasksRepository,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(DestinationService)
    private readonly destinations: DestinationService,
    @Inject(DeliveryJobRepository)
    private readonly deliveryJobs: DeliveryJobRepository,
    @Inject(NotificationRepository)
    private readonly notifications: NotificationRepository,
  ) {}
  private async insert(
    input: PublishMessage,
    tx: Transaction,
    idempotencyKey?: string,
  ) {
    const suggestedReplies = parseSuggestedReplies(input.suggestedReplies);
    if (
      suggestedReplies.length &&
      (input.role !== 'assistant' || !input.text.trim())
    )
      throw new ApplicationError(
        'invalid_input',
        'Suggested replies require an assistant message with text.',
      );
    if (input.source !== undefined && !input.source.trim())
      throw new ApplicationError('invalid_input', 'Invalid message source');
    if (!input.text.trim() && !input.attachmentIds?.length)
      throw new ApplicationError(
        'invalid_input',
        'Message requires text or attachments',
      );
    if (input.taskId && !(await this.tasks.get(input.taskId, tx)))
      throw new ApplicationError('not_found', 'Task not found');
    const taskId = input.taskId ?? null;
    const phase = input.role === 'assistant' ? (input.phase ?? null) : null;
    const secureEntryRequestId =
      input.role === 'assistant' && taskId
        ? input.metadata?.secureEntryRequestId
        : undefined;
    const resolved =
      input.role === 'assistant' && !taskId
        ? await this.destinations.resolve(
            input.destinationIds ?? [],
            input.notify ?? false,
            tx,
          )
        : {
            deliveryDestinationIds: [],
            notificationDestinationIds: [],
          };
    const delivery = {
      deliveryDestinationIds: resolved.deliveryDestinationIds,
      notificationDestinationIds: resolved.notificationDestinationIds,
    };
    const target = input.replyToMessageId
      ? await this.repository.get(input.replyToMessageId, tx)
      : Number.isSafeInteger(input.replyToSequence) &&
          (input.replyToSequence ?? 0) > 0
        ? await this.repository.getBySequence(input.replyToSequence!, tx)
        : undefined;
    const targetVisible =
      target &&
      (messageVisibleInChat(target, taskId) ||
        (input.role === 'assistant' &&
          taskId !== null &&
          phase === 'final_answer' &&
          messageVisibleInChat(target, null)));
    if (input.role === 'user' && input.replyToMessageId && !targetVisible)
      throw new ApplicationError(
        'invalid_input',
        'Reply target is not in this chat',
      );
    const row = await this.repository.create(
      {
        role: input.role,
        source: input.role === 'user' ? (input.source ?? 'api') : null,
        originDestinationId:
          input.role === 'user' ? (input.originDestinationId ?? null) : null,
        ...delivery,
        idempotencyKey: idempotencyKey ?? null,
        replyToMessageId: targetVisible ? target.id : null,
        text: input.text,
        metadata: {
          ...(input.metadata?.timezone
            ? { timezone: input.metadata.timezone }
            : {}),
          ...(secureEntryRequestId ? { secureEntryRequestId } : {}),
        },
        taskId,
        mainVisible: !!secureEntryRequestId,
        phase,
        suggestedReplies,
      },
      tx,
    );
    await this.files.attachToMessage(row.id, input.attachmentIds ?? [], tx);
    if (
      input.role === 'assistant' &&
      messageVisibleInChat(row, null) &&
      'secondaryDestinationIds' in resolved
    ) {
      await this.deliveryJobs.enqueue(
        row.id,
        resolved.secondaryDestinationIds,
        resolved.notificationDestinationIds,
        tx,
      );
      await this.notifications.enqueue(
        row.id,
        resolved.notificationDestinationIds,
        tx,
      );
    }
    const activityTask = taskId
      ? taskView(await this.tasks.recordActivity(taskId, row.createdAt, tx))
      : undefined;
    const [message] = await this.repository.views([row], tx);
    return { message, activityTask };
  }
  async publish(
    input: PublishMessage,
    key?: string,
    request: Record<string, unknown> = { ...input },
  ) {
    let inserted: Awaited<ReturnType<ChatService['insert']>> | undefined;
    if (key) {
      const result = await this.database.idempotent(
        'chat.publish',
        key,
        request,
        async (tx) => {
          inserted = await this.insert(input, tx);
          return { messageId: inserted.message.id };
        },
      );
      if (!inserted) return this.get(result.messageId);
    } else {
      inserted = await this.database.transaction((tx) =>
        this.insert(input, tx),
      );
    }
    this.events.publish({ event: 'message.added', message: inserted.message });
    if (inserted.activityTask)
      this.events.publish({
        event: 'task.updated',
        task: inserted.activityTask,
      });
    return inserted.message;
  }

  async react(
    input: {
      messageRef: number;
      emoji: string;
      destinationIds: string[];
      notify: boolean;
    },
    key: string,
  ) {
    // One extended grapheme keeps compound emoji (skin tones, flags, ZWJ sequences) intact.
    if (
      [
        ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
          input.emoji,
        ),
      ].length !== 1 ||
      !/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(
        input.emoji,
      )
    )
      throw new ApplicationError('invalid_input', 'Reaction must be one emoji');
    let updated;
    const result = await this.database.idempotent(
      'chat.react',
      key,
      input,
      async (tx) => {
        const target = await this.repository.getBySequence(
          input.messageRef,
          tx,
        );
        if (!target || !messageVisibleInChat(target, null))
          throw new ApplicationError(
            'invalid_input',
            'Reaction target is not in Main chat',
          );
        await this.repository.lock(target.id, tx);
        const resolved = await this.destinations.resolve(
          input.destinationIds,
          input.notify,
          tx,
        );
        const row = await this.repository.update(
          target.id,
          { reaction: input.emoji },
          tx,
        );
        await this.deliveryJobs.enqueue(
          row.id,
          resolved.secondaryDestinationIds,
          resolved.notificationDestinationIds,
          tx,
          { version: row.version, reaction: input.emoji },
        );
        await this.notifications.enqueue(
          row.id,
          resolved.notificationDestinationIds,
          tx,
          { version: row.version, reaction: input.emoji },
        );
        [updated] = await this.repository.views([row], tx);
        return { messageId: row.id };
      },
    );
    if (updated)
      this.events.publish({ event: 'message.updated', message: updated });
    return updated ?? this.get(result.messageId);
  }
  async accept(input: SubmitMessageInput) {
    const request = {
      ...(input.source && input.source !== 'api'
        ? { source: input.source }
        : {}),
      ...(input.originDestinationId
        ? { originDestinationId: input.originDestinationId }
        : {}),
      text: input.text,
      ...(input.suggestedReply ? { suggestedReply: input.suggestedReply } : {}),
      taskId: input.taskId ?? null,
      ...(input.replyToMessageId
        ? { replyToMessageId: input.replyToMessageId }
        : {}),
      attachmentIds: input.attachmentIds,
      ...(input.metadata?.timezone
        ? { metadata: { timezone: input.metadata.timezone } }
        : {}),
    };
    let inserted: Awaited<ReturnType<ChatService['insert']>> | undefined;
    let consumed;
    const result = await this.database.idempotent(
      'chat.messages',
      input.idempotencyKey,
      request,
      async (tx) => {
        let text = input.text;
        if (input.suggestedReply) {
          if (text || input.attachmentIds.length || input.replyToMessageId)
            throw new ApplicationError(
              'invalid_input',
              'Suggested replies are submitted on their own.',
            );
          const { messageId, index } = input.suggestedReply;
          const source = await this.repository.lock(messageId, tx);
          if (
            !source ||
            source.role !== 'assistant' ||
            !messageVisibleInChat(source, input.taskId ?? null)
          )
            throw new ApplicationError(
              'invalid_input',
              'Suggested reply is not in this chat.',
            );
          if (
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= source.suggestedReplies.length
          )
            throw new ApplicationError(
              'conflict',
              'Suggested reply is no longer available.',
            );
          text = source.suggestedReplies[index]!;
          const updated = await this.repository.update(
            source.id,
            { suggestedReplies: [] },
            tx,
          );
          [consumed] = await this.repository.views([updated], tx);
        }
        inserted = await this.insert(
          { ...input, text, role: 'user' },
          tx,
          input.idempotencyKey,
        );
        return { messageId: inserted.message.id };
      },
    );
    if (consumed)
      this.events.publish({ event: 'message.updated', message: consumed });
    if (inserted) {
      this.events.publish({
        event: 'message.added',
        message: inserted.message,
      });
      if (inserted.activityTask)
        this.events.publish({
          event: 'task.updated',
          task: inserted.activityTask,
        });
    }
    return result;
  }
  async get(id: string) {
    return this.database.db.transaction(
      async (tx) => {
        const row = await this.repository.get(id, tx);
        if (!row) throw new ApplicationError('not_found', 'Message not found');
        const [message] = await this.repository.views([row], tx);
        return message;
      },
      { isolationLevel: 'repeatable read' },
    );
  }
  async getBySequence(sequence: number) {
    if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
    const row = await this.repository.getBySequence(sequence);
    if (!row) return null;
    const [message] = await this.repository.views([row], this.database.db);
    return message;
  }
  async update(
    id: string,
    input: {
      text?: string;
    },
  ) {
    const message = await this.database.transaction(async (tx) => {
      const current = await this.repository.lock(id, tx);
      if (!current)
        throw new ApplicationError('not_found', 'Message not found');
      const row = await this.repository.update(id, input, tx);
      const [view] = await this.repository.views([row], tx);
      return view;
    });
    this.events.publish({ event: 'message.updated', message });
    return message;
  }
  async history(options: { taskId?: string; before?: number; limit?: number }) {
    return this.database.db.transaction(
      async (tx) => {
        if (options.taskId && !(await this.tasks.get(options.taskId, tx)))
          throw new ApplicationError('not_found', 'Task not found');
        const limit = options.limit ?? 20;
        const rows = await this.repository.list({ ...options, limit }, tx);
        const page = rows.slice(0, limit);
        return {
          messages: await this.repository.views(page, tx),
          before: rows.length > limit ? (page.at(-1)?.sequence ?? null) : null,
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}

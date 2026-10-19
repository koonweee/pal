import { renderMarkdown, splitTelegramText } from './telegram-format.js';
import { Readable } from 'node:stream';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DeliveryOutcome,
  ExternalReference,
  SecondaryDriver,
  SecondaryInput,
  SecondaryOutput,
} from '../secondary/secondary-driver.js';
import { SecondaryDriverHostService } from '../secondary/secondary-driver-host.service.js';

export interface TelegramFile {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}
export interface TelegramMessage {
  message_id: number;
  from?: { id: number };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  photo?: TelegramFile[];
  document?: TelegramFile;
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export function telegramOwnerEnvelope(update: TelegramUpdate, ownerId: string) {
  const message = update.message;
  if (
    !message ||
    message.chat.type !== 'private' ||
    String(message.chat.id) !== ownerId ||
    String(message.from?.id) !== ownerId
  )
    return null;
  return {
    externalEventId: String(update.update_id),
    externalMessageId: String(message.message_id),
    externalThreadId: String(message.chat.id),
    text: message.text ?? message.caption ?? '',
    files: [
      ...(message.photo?.length ? [message.photo.at(-1)!] : []),
      ...(message.document ? [message.document] : []),
    ],
    replyToExternalMessageId: message.reply_to_message
      ? String(message.reply_to_message.message_id)
      : undefined,
  };
}

export function classifyTelegramFailure(
  status: number,
  data: Pick<TelegramResponse<unknown>, 'error_code' | 'parameters'>,
): DeliveryOutcome {
  const effectiveStatus = data.error_code ?? status;
  const code = `telegram_${effectiveStatus}`;
  return effectiveStatus === 429 || effectiveStatus >= 500
    ? {
        kind: 'retryable',
        code,
        ...(data.parameters?.retry_after
          ? { retryAfterMs: data.parameters.retry_after * 1000 }
          : {}),
      }
    : { kind: 'permanent', code };
}

// Node identifies this reset before secureConnect, so no HTTPS request was sent.
// ECONNRESET alone can also occur after transmission and must remain uncertain.
function classifyTransportFailure(error: unknown): DeliveryOutcome {
  const cause = error instanceof Error ? error.cause : undefined;
  if (
    cause instanceof Error &&
    'code' in cause &&
    cause.code === 'ECONNRESET' &&
    cause.message ===
      'Client network socket disconnected before secure TLS connection was established'
  )
    return { kind: 'retryable', code: 'transport_not_sent' };
  return { kind: 'uncertain', code: 'transport_uncertain' };
}

/** Telegram owner-DM implementation of the shared secondary driver contract. */
@Injectable()
export class TelegramDriver implements SecondaryDriver, OnModuleInit {
  readonly adapterId = 'telegram';
  readonly destinationId = 'telegram';
  private readonly logger = new Logger(TelegramDriver.name);
  private readonly token?: string;
  private readonly ownerId?: string;
  private controller?: AbortController;
  private polling?: Promise<void>;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(SecondaryDriverHostService)
    private readonly host: SecondaryDriverHostService,
  ) {
    this.token = config.get<string>('PAL_TELEGRAM_BOT_TOKEN');
    this.ownerId = config.get<string>('PAL_TELEGRAM_OWNER_ID');
  }

  async onModuleInit() {
    const configured = !!this.token && !!this.ownerId;
    await this.host.configure(this, configured);
  }

  async start(ingress: (input: SecondaryInput) => Promise<void>) {
    if (!this.token || !this.ownerId || this.polling) return;
    this.controller = new AbortController();
    this.polling = this.poll(ingress, this.controller.signal).catch((error) => {
      if (!this.controller?.signal.aborted) this.logger.error(error);
    });
  }

  async stop() {
    this.controller?.abort();
    await this.polling;
    this.polling = undefined;
  }

  private async poll(
    ingress: (input: SecondaryInput) => Promise<void>,
    signal: AbortSignal,
  ) {
    const stored = await this.host.state(this, 'poll');
    let offset = typeof stored?.offset === 'number' ? stored.offset : undefined;
    if (offset === undefined) {
      const latest = await this.call<TelegramUpdate[]>(
        'getUpdates',
        {
          offset: -1,
          timeout: 0,
          allowed_updates: ['message'],
        },
        signal,
      );
      offset = (latest.at(-1)?.update_id ?? -1) + 1;
      await this.host.setState(this, 'poll', { offset });
    }
    while (!signal.aborted) {
      try {
        const updates: TelegramUpdate[] = await this.call<TelegramUpdate[]>(
          'getUpdates',
          {
            offset,
            timeout: 20,
            allowed_updates: ['message'],
          },
          signal,
        );
        for (const update of updates) {
          await this.ingest(update, ingress, signal);
          offset = update.update_id + 1;
          await this.host.setState(this, 'poll', { offset });
        }
      } catch (error) {
        if (signal.aborted) return;
        this.logger.warn(
          `Telegram intake failed: ${this.redactedDetails(this.errorDetails(error))}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  private async ingest(
    update: TelegramUpdate,
    ingress: (input: SecondaryInput) => Promise<void>,
    signal: AbortSignal,
  ) {
    const envelope = telegramOwnerEnvelope(update, this.ownerId!);
    if (!envelope) {
      this.logger.warn(`Rejected Telegram update ${update.update_id}`);
      return;
    }
    const attachments = [];
    for (const file of envelope.files) {
      const info = await this.call<{ file_path?: string }>(
        'getFile',
        { file_id: file.file_id },
        signal,
      );
      if (!info.file_path) throw new Error('telegram_file_unavailable');
      const response = await fetch(
        `https://api.telegram.org/file/bot${this.token}/${info.file_path}`,
        { signal },
      );
      if (!response.ok || !response.body)
        throw new Error(`telegram_file_${response.status}`);
      attachments.push({
        stream: Readable.fromWeb(response.body as never),
        filename:
          file.file_name ?? info.file_path.split('/').at(-1) ?? 'telegram-file',
        contentType:
          file.mime_type ?? response.headers.get('content-type') ?? undefined,
      });
    }
    await ingress({
      externalEventId: envelope.externalEventId,
      externalMessageId: envelope.externalMessageId,
      externalThreadId: envelope.externalThreadId,
      text: envelope.text,
      attachments,
      ...(envelope.replyToExternalMessageId
        ? { replyToExternalMessageId: envelope.replyToExternalMessageId }
        : {}),
    });
  }

  async send(output: SecondaryOutput): Promise<DeliveryOutcome> {
    if (!this.token || !this.ownerId)
      return { kind: 'permanent', code: 'not_configured' };
    if (output.reaction) return this.sendReaction(output);
    const references: ExternalReference[] = [];
    let position = 0;
    try {
      const rendered = renderMarkdown(output.message.text);
      const attachments = output.message.attachments;
      const caption =
        attachments.length > 0 && rendered.text.length <= 1024
          ? rendered
          : undefined;
      for (const part of caption ? [] : splitTelegramText(rendered)) {
        const sent = await this.sendMethod<{ message_id: number }>(
          'sendMessage',
          {
            chat_id: this.ownerId,
            text: part.text,
            entities: part.entities,
            disable_notification: !output.notify,
            ...(position === 0 && output.replyTo
              ? {
                  reply_parameters: {
                    message_id: Number(output.replyTo.externalMessageId),
                  },
                }
              : {}),
          },
          {
            deliveryId: output.deliveryId,
            messageId: output.message.id,
            position,
          },
        );
        if (!sent.ok)
          return references.length
            ? { kind: 'uncertain', code: 'partial_delivery', references }
            : sent.outcome;
        references.push({
          externalMessageId: String(sent.result.message_id),
          externalThreadId: this.ownerId,
          position,
        });
        position++;
      }
      for (let index = 0; index < attachments.length;) {
        const first = attachments[index];
        const photo = first.contentType.startsWith('image/');
        const group = [first];
        if (photo) {
          while (
            group.length < 10 &&
            index + group.length < attachments.length &&
            attachments[index + group.length].contentType.startsWith('image/')
          ) {
            group.push(attachments[index + group.length]);
          }
        }
        const album = group.length > 1;
        const form = new FormData();
        form.set('chat_id', this.ownerId);
        form.set('disable_notification', String(!output.notify));
        if (position === 0 && output.replyTo)
          form.set(
            'reply_parameters',
            JSON.stringify({
              message_id: Number(output.replyTo.externalMessageId),
            }),
          );
        const media = [];
        for (const [itemIndex, attachment] of group.entries()) {
          const content = await output.openAttachment(attachment);
          const buffers: Buffer[] = [];
          for await (const chunk of content.stream)
            buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const field = album
            ? `file${itemIndex}`
            : photo
              ? 'photo'
              : 'document';
          form.set(
            field,
            new Blob([new Uint8Array(Buffer.concat(buffers))], {
              type: content.contentType,
            }),
            attachment.filename,
          );
          const itemCaption =
            index === 0 && itemIndex === 0 ? caption : undefined;
          if (album) {
            media.push({
              type: 'photo',
              media: `attach://${field}`,
              ...(itemCaption
                ? {
                    caption: itemCaption.text,
                    caption_entities: itemCaption.entities,
                  }
                : {}),
            });
          } else if (itemCaption) {
            form.set('caption', itemCaption.text);
            form.set('caption_entities', JSON.stringify(itemCaption.entities));
          }
        }
        if (album) form.set('media', JSON.stringify(media));
        const sent = await this.sendMethod<
          { message_id: number } | { message_id: number }[]
        >(
          album ? 'sendMediaGroup' : photo ? 'sendPhoto' : 'sendDocument',
          form,
          {
            deliveryId: output.deliveryId,
            messageId: output.message.id,
            position,
          },
        );
        if (!sent.ok)
          return references.length
            ? { kind: 'uncertain', code: 'partial_delivery', references }
            : sent.outcome;
        for (const message of Array.isArray(sent.result)
          ? sent.result
          : [sent.result]) {
          references.push({
            externalMessageId: String(message.message_id),
            externalThreadId: this.ownerId,
            position: position++,
          });
        }
        index += group.length;
      }
      return { kind: 'accepted', references };
    } catch (error) {
      this.logSendFailure({
        deliveryId: output.deliveryId,
        messageId: output.message.id,
        position,
        stage: 'adapter',
        error: this.errorDetails(error),
      });
      return {
        kind: 'uncertain',
        code: references.length ? 'partial_delivery' : 'transport_uncertain',
        ...(references.length ? { references } : {}),
      };
    }
  }

  private async sendReaction(
    output: SecondaryOutput,
  ): Promise<DeliveryOutcome> {
    const context = {
      deliveryId: output.deliveryId,
      messageId: output.message.id,
      position: 0,
    };
    if (output.replyTo) {
      const native = await this.sendMethod<boolean>(
        'setMessageReaction',
        {
          chat_id: this.ownerId,
          message_id: Number(output.replyTo.externalMessageId),
          reaction: [{ type: 'emoji', emoji: output.reaction }],
        },
        context,
      );
      if (native.ok) return { kind: 'accepted', references: [] };
      // Only a known rejected request may fall back. Ambiguous acceptance must stop.
      if (
        native.outcome.kind !== 'permanent' ||
        native.outcome.code !== 'telegram_400'
      )
        return native.outcome;
    }
    const fallback = await this.sendMethod<{ message_id: number }>(
      'sendMessage',
      {
        chat_id: this.ownerId,
        text: output.reaction,
        disable_notification: !output.notify,
        ...(output.replyTo
          ? {
              reply_parameters: {
                message_id: Number(output.replyTo.externalMessageId),
                allow_sending_without_reply: true,
              },
            }
          : {}),
      },
      context,
    );
    return fallback.ok
      ? { kind: 'accepted', references: [] }
      : fallback.outcome;
  }

  private async sendMethod<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    context: { deliveryId: string; messageId: string; position: number },
  ) {
    let response: Response;
    try {
      response = await fetch(
        `https://api.telegram.org/bot${this.token}/${method}`,
        {
          method: 'POST',
          ...(body instanceof FormData
            ? { body }
            : {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              }),
        },
      );
    } catch (error) {
      this.logSendFailure({
        ...context,
        method,
        stage: 'transport',
        error: this.errorDetails(error),
      });
      return {
        ok: false as const,
        outcome: classifyTransportFailure(error),
      };
    }
    const data = (await response.json().catch((error: unknown) => {
      this.logSendFailure({
        ...context,
        method,
        stage: 'response_decode',
        httpStatus: response.status,
        error: this.errorDetails(error),
      });
      return {};
    })) as TelegramResponse<T>;
    if (response.ok && data.ok && data.result)
      return { ok: true as const, result: data.result };
    this.logSendFailure({
      ...context,
      method,
      stage: 'api',
      httpStatus: response.status,
      errorCode: data.error_code,
      description: data.description,
      retryAfterSeconds: data.parameters?.retry_after,
    });
    return {
      ok: false as const,
      outcome: classifyTelegramFailure(response.status, data),
    };
  }

  private errorDetails(error: unknown): unknown {
    if (!(error instanceof Error)) return { message: 'Unknown exception' };
    const code = 'code' in error ? error.code : undefined;
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      code: typeof code === 'string' ? code : undefined,
      cause:
        cause instanceof Error
          ? {
              name: cause.name,
              message: cause.message,
              code:
                'code' in cause && typeof cause.code === 'string'
                  ? cause.code
                  : undefined,
            }
          : undefined,
    };
  }

  private logSendFailure(details: Record<string, unknown>) {
    this.logger.error(`Telegram send failed: ${this.redactedDetails(details)}`);
  }

  private redactedDetails(details: unknown): string {
    const serialized = JSON.stringify(details);
    return this.token
      ? serialized.replaceAll(this.token, '[redacted]')
      : serialized;
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      },
    );
    const data = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !data.ok || data.result === undefined)
      throw new Error(`telegram_${data.error_code ?? response.status}`);
    return data.result;
  }
}

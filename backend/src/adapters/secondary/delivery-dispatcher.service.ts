import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ChatService } from '../../chat/chat.service.js';
import { DeliveryJobRepository } from '../../delivery/delivery-job.repository.js';
import { FilesService } from '../../files/files.service.js';
import type { DeliveryOutcome } from './secondary-driver.js';
import { SecondaryIngressService } from './secondary-ingress.service.js';
import { SecondaryRepository } from './secondary.repository.js';
import { SecondaryDriverHostService } from './secondary-driver-host.service.js';

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 5_000, 30_000, 120_000];

export function nextDeliveryState(
  outcome: DeliveryOutcome,
  attempts: number,
  now = Date.now(),
) {
  if (outcome.kind === 'accepted') return { state: 'accepted' as const };
  if (outcome.kind === 'uncertain')
    return { state: 'uncertain' as const, errorCode: outcome.code };
  if (outcome.kind === 'permanent' || attempts >= MAX_ATTEMPTS)
    return { state: 'failed' as const, errorCode: outcome.code };
  const delay = Math.max(
    BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
    outcome.retryAfterMs ?? 0,
  );
  return {
    state: 'pending' as const,
    errorCode: outcome.code,
    nextAttemptAt: new Date(now + delay),
  };
}

@Injectable()
export class DeliveryDispatcherService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(DeliveryDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private current?: Promise<void>;
  private closing = false;

  constructor(
    @Inject(DeliveryJobRepository)
    private readonly jobs: DeliveryJobRepository,
    @Inject(SecondaryDriverHostService)
    private readonly drivers: SecondaryDriverHostService,
    @Inject(SecondaryIngressService)
    private readonly ingress: SecondaryIngressService,
    @Inject(SecondaryRepository)
    private readonly references: SecondaryRepository,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  async onApplicationBootstrap() {
    const interrupted = await this.jobs.recoverInterrupted();
    for (const job of interrupted)
      this.logger.error(
        `Uncertain interrupted send delivery=${job.id} message=${job.messageId} destination=${job.destinationId}`,
      );
    await this.jobs.cancelDisabled();
    for (const driver of this.drivers.all())
      await driver.start((input) =>
        this.ingress.accept(driver, input).then(() => {}),
      );
    this.timer = setInterval(() => this.wake(), 1_000);
    this.timer.unref();
    this.wake();
  }

  private wake() {
    if (this.closing || this.current) return;
    this.current = this.drain()
      .catch((error: unknown) => this.logger.error(error))
      .finally(() => {
        this.current = undefined;
      });
  }

  private async drain() {
    await this.jobs.cancelDisabled();
    while (!this.closing) {
      const job = await this.jobs.claim();
      if (!job) return;
      const driver = this.drivers.get(job.destinationId);
      if (!driver || driver.adapterId !== job.adapterId) {
        await this.jobs.setState(job.id, 'failed', {
          errorCode: 'driver_unavailable',
        });
        this.logger.error(
          `Delivery driver unavailable delivery=${job.id} destination=${job.destinationId}`,
        );
        continue;
      }
      let outcome: DeliveryOutcome;
      try {
        const message = await this.chat.get(job.messageId);
        if (job.reaction && message.version > job.messageVersion) {
          await this.jobs.setState(job.id, 'cancelled', {
            errorCode: 'superseded_reaction',
          });
          continue;
        }
        const targetId = job.reaction ? message.id : message.replyToMessageId;
        const reply = targetId
          ? (
              await this.references.referencesFor(
                job.adapterId,
                job.destinationId,
                targetId,
              )
            )[0]
          : undefined;
        outcome = await driver.send({
          deliveryId: job.id,
          message,
          notify: job.notify,
          reaction: job.reaction ?? undefined,
          replyTo: reply
            ? {
                externalMessageId: reply.externalMessageId,
                externalThreadId: reply.externalThreadId ?? undefined,
                position: reply.position,
              }
            : undefined,
          openAttachment: async (attachment) => {
            const { file, handle } = await this.files.content(attachment.id);
            return {
              stream: handle.createReadStream(),
              contentType: file.contentType,
              sizeBytes: file.sizeBytes,
            };
          },
        });
        if (
          !job.reaction &&
          'references' in outcome &&
          outcome.references?.length
        )
          await this.references.recordOutgoingReferences(
            job.adapterId,
            job.destinationId,
            job.messageId,
            outcome.references,
          );
      } catch {
        this.logger.error(
          `Delivery infrastructure failed delivery=${job.id} message=${job.messageId} destination=${job.destinationId}`,
        );
        outcome = { kind: 'uncertain', code: 'adapter_exception' };
      }
      const next = nextDeliveryState(outcome, job.attempts);
      await this.jobs.setState(job.id, next.state, {
        errorCode: next.errorCode ?? null,
        ...('nextAttemptAt' in next
          ? { nextAttemptAt: next.nextAttemptAt }
          : {}),
      });
      if (next.state === 'failed' || next.state === 'uncertain')
        this.logger.error(
          `Delivery ${next.state} delivery=${job.id} message=${job.messageId} destination=${job.destinationId} code=${next.errorCode}`,
        );
    }
  }

  async beforeApplicationShutdown() {
    this.closing = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.drivers.all().map((driver) => driver.stop()));
    await this.current;
  }
}

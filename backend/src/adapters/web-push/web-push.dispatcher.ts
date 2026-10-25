import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ChatService } from '../../chat/chat.service.js';
import { NotificationRepository } from '../../notifications/notification.repository.js';
import { InstanceSettingsService } from '../../instance-settings/instance-settings.service.js';
import { WebPushRepository } from './web-push.repository.js';
import { WebPushProvider, webPushPayload } from './web-push.provider.js';

@Injectable()
export class WebPushDispatcher
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WebPushDispatcher.name);
  private timer?: NodeJS.Timeout;
  private current?: Promise<void>;
  private closing = false;

  constructor(
    @Inject(NotificationRepository)
    private readonly intents: NotificationRepository,
    @Inject(WebPushRepository) private readonly repository: WebPushRepository,
    @Inject(WebPushProvider) private readonly provider: WebPushProvider,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(InstanceSettingsService)
    private readonly settings: InstanceSettingsService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.provider.enabled) return;
    await this.repository.recoverInterrupted();
    this.timer = setInterval(() => this.wake(), 1000);
    this.timer.unref();
    this.wake();
  }

  private wake() {
    if (this.closing || this.current) return;
    this.current = this.drain()
      .catch(() => this.logger.error('Web Push dispatch failed'))
      .finally(() => {
        this.current = undefined;
      });
  }

  async drain() {
    while (
      !this.closing &&
      (await this.intents.expand('web', (intent, tx) =>
        this.repository.materialize(intent, tx),
      ))
    ) {
      /* atomic fanout */
    }
    while (!this.closing) {
      const work = await this.repository.claim();
      if (!work) return;
      const { delivery, intent, installation } = work;
      if (intent.expiresAt.getTime() <= Date.now()) {
        await this.repository.settle(delivery.id, 'cancelled', {
          errorCode: 'expired',
        });
        continue;
      }
      if (
        !installation?.enabled ||
        installation.generation !== delivery.generation
      ) {
        await this.repository.settle(delivery.id, 'cancelled', {
          errorCode: 'registration_changed',
        });
        continue;
      }
      try {
        const message = await this.chat.get(intent.messageId);
        if (intent.reaction && message.version > intent.messageVersion) {
          await this.repository.settle(delivery.id, 'cancelled', {
            errorCode: 'superseded_reaction',
          });
          continue;
        }
        const settings = await this.settings.get();
        const outcome = await this.provider.send(
          installation,
          webPushPayload(
            settings.agentName,
            message.text,
            intent.id,
            intent.reaction ?? undefined,
            await this.repository.badge(installation.id),
          ),
        );
        if (outcome.kind === 'invalid-registration')
          await this.repository.disable(installation.id, delivery.generation);
        if (outcome.kind === 'accepted') {
          await this.repository.settle(delivery.id, 'accepted');
        } else if (outcome.kind === 'retryable' && delivery.attempts < 4) {
          const delay = Math.max(
            [1000, 5000, 30000][delivery.attempts - 1],
            outcome.retryAfterMs ?? 0,
          );
          const nextAttemptAt = new Date(Date.now() + delay);
          await this.repository.settle(
            delivery.id,
            nextAttemptAt < intent.expiresAt ? 'pending' : 'cancelled',
            {
              errorCode:
                nextAttemptAt < intent.expiresAt ? outcome.code : 'expired',
              nextAttemptAt,
            },
          );
        } else {
          await this.repository.settle(
            delivery.id,
            outcome.kind === 'uncertain' ? 'uncertain' : 'failed',
            { errorCode: outcome.code },
          );
        }
      } catch {
        await this.repository.settle(delivery.id, 'uncertain', {
          errorCode: 'adapter_exception',
        });
      }
    }
  }

  async beforeApplicationShutdown() {
    this.closing = true;
    clearInterval(this.timer);
    await this.current;
  }
}

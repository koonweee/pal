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
import {
  ApnsProvider,
  type NativeNotificationOutcome,
} from '../apns/apns.provider.js';
import { NativeInstallationRepository } from './native-installation.repository.js';

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 5_000, 30_000, 120_000];

export function nextNotificationState(
  outcome: NativeNotificationOutcome,
  attempts: number,
  now = Date.now(),
) {
  if (outcome.kind === 'accepted') return { state: 'accepted' as const };
  if (outcome.kind === 'uncertain')
    return { state: 'uncertain' as const, errorCode: outcome.code };
  if (outcome.kind === 'invalid-registration')
    return { state: 'failed' as const, errorCode: outcome.code };
  if (outcome.kind === 'permanent' || attempts >= MAX_ATTEMPTS)
    return { state: 'failed' as const, errorCode: outcome.code };
  return {
    state: 'pending' as const,
    errorCode: outcome.code,
    nextAttemptAt: new Date(
      now + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
    ),
  };
}

@Injectable()
export class NativeNotificationDispatcher
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(NativeNotificationDispatcher.name);
  private timer?: NodeJS.Timeout;
  private current?: Promise<void>;
  private closing = false;

  constructor(
    @Inject(NotificationRepository)
    private readonly intents: NotificationRepository,
    @Inject(NativeInstallationRepository)
    private readonly installations: NativeInstallationRepository,
    @Inject(ApnsProvider) private readonly provider: ApnsProvider,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(InstanceSettingsService)
    private readonly settings: InstanceSettingsService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.provider.enabled) return;
    const interrupted = await this.intents.recoverInterrupted('ios');
    for (const intent of interrupted)
      this.logger.error(
        `Uncertain interrupted notification intent=${intent.id} message=${intent.messageId}`,
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
    while (!this.closing) {
      const intent = await this.intents.claim('ios');
      if (!intent) return;
      const installation = await this.installations.active();
      if (!installation) {
        await this.intents.setState(intent.id, 'cancelled', {
          errorCode: 'no_active_installation',
        });
        continue;
      }
      let outcome: NativeNotificationOutcome;
      try {
        const message = await this.chat.get(intent.messageId);
        if (intent.reaction) {
          if (message.version > intent.messageVersion) {
            await this.intents.setState(intent.id, 'cancelled', {
              errorCode: 'superseded_reaction',
            });
            continue;
          }
        }
        const settings = await this.settings.get();
        outcome = await this.provider.send(
          installation,
          intent,
          message,
          settings.agentName,
        );
      } catch {
        outcome = { kind: 'uncertain', code: 'adapter_exception' };
      }
      if (outcome.kind === 'invalid-registration')
        await this.installations.disableIfGeneration(
          installation.id,
          installation.generation,
        );
      const next = nextNotificationState(outcome, intent.attempts);
      await this.intents.setState(intent.id, next.state, {
        errorCode: next.errorCode ?? null,
        ...('nextAttemptAt' in next
          ? { nextAttemptAt: next.nextAttemptAt }
          : {}),
      });
      if (next.state === 'failed' || next.state === 'uncertain')
        this.logger.error(
          `Notification ${next.state} intent=${intent.id} message=${intent.messageId} code=${next.errorCode}`,
        );
    }
  }

  async beforeApplicationShutdown() {
    this.closing = true;
    clearInterval(this.timer);
    this.provider.close();
    await this.current;
  }
}

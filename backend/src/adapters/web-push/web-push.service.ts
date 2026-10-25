import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationError } from '../../application/contracts/errors.js';
import { validateSubscription } from './web-push.policy.js';
import { WebPushRepository } from './web-push.repository.js';

@Injectable()
export class WebPushService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(WebPushRepository) private readonly repository: WebPushRepository,
  ) {}

  configuration() {
    const available = (
      this.config.get<string[]>('PAL_NOTIFICATION_DESTINATIONS') ?? []
    ).includes('web');
    return {
      available,
      publicKey: available
        ? this.config.getOrThrow<string>('PAL_WEB_PUSH_PUBLIC_KEY')
        : null,
    };
  }

  async register(input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }) {
    if (!this.configuration().available)
      throw new ApplicationError(
        'unavailable',
        'Notifications are unavailable',
      );
    validateSubscription(input);
    const row = await this.repository.register(input);
    return { id: row.id };
  }

  badge(id: string, seen?: { generation: number; through: number }) {
    return this.repository.badge(id, seen);
  }

  async disable(id: string) {
    await this.repository.disable(id);
  }
}

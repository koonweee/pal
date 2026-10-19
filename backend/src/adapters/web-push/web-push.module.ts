import { Module } from '@nestjs/common';
import { ChatModule } from '../../chat/chat.module.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';
import { InstanceSettingsModule } from '../../instance-settings/instance-settings.module.js';
import { WebPushController } from './web-push.controller.js';
import { WebPushService } from './web-push.service.js';
import { WebPushRepository } from './web-push.repository.js';
import { WebPushProvider } from './web-push.provider.js';
import { WebPushDispatcher } from './web-push.dispatcher.js';

@Module({
  imports: [ChatModule, NotificationsModule, InstanceSettingsModule],
  controllers: [WebPushController],
  providers: [
    WebPushService,
    WebPushRepository,
    WebPushProvider,
    WebPushDispatcher,
  ],
})
export class WebPushModule {}

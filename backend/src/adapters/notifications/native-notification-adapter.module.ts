import { Module } from '@nestjs/common';
import { ChatModule } from '../../chat/chat.module.js';
import { NotificationsModule } from '../../notifications/notifications.module.js';
import { InstanceSettingsModule } from '../../instance-settings/instance-settings.module.js';
import { ApnsProvider } from '../apns/apns.provider.js';
import { NativeInstallationRepository } from './native-installation.repository.js';
import { NativeNotificationDispatcher } from './native-notification.dispatcher.js';
import { NativeNotificationsController } from './native-notifications.controller.js';

@Module({
  imports: [ChatModule, NotificationsModule, InstanceSettingsModule],
  controllers: [NativeNotificationsController],
  providers: [
    ApnsProvider,
    NativeInstallationRepository,
    NativeNotificationDispatcher,
  ],
})
/** Owns native registration and APNs delivery; Pal core stores only intent. */
export class NativeNotificationAdapterModule {}

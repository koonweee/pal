import { Module } from '@nestjs/common';
import { NotificationRepository } from './notification.repository.js';

@Module({
  providers: [NotificationRepository],
  exports: [NotificationRepository],
})
/** Provider-neutral notification intent persistence. */
export class NotificationsModule {}

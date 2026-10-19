import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { ChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { DeliveryModule } from '../delivery/delivery.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
@Module({
  imports: [FilesModule, TasksModule, DeliveryModule, NotificationsModule],
  providers: [ChatRepository, ChatService],
  exports: [ChatService],
})
export class ChatModule {}

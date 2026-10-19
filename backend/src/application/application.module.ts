import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { AgentModule } from '../agent/agent.module.js';
import { ChatCoordinatorService } from './chat-coordinator.service.js';
@Module({
  imports: [ChatModule, AgentModule],
  providers: [ChatCoordinatorService],
  exports: [ChatCoordinatorService],
})
export class ApplicationModule {}

import { DeliveryModule } from '../delivery/delivery.module.js';
import { BrowserService } from '../browser/browser.service.js';
import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { FilesModule } from '../files/files.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { PreferencesModule } from '../preferences/preferences.module.js';
import { InstanceSettingsModule } from '../instance-settings/instance-settings.module.js';
import { AGENT_RUNTIME } from './agent-runtime.js';
import { MastraAgentRuntime } from './mastra-agent-runtime.js';
import { AgentActivityService } from './agent-activity.service.js';
@Module({
  imports: [
    DeliveryModule,
    ChatModule,
    TasksModule,
    FilesModule,
    PreferencesModule,
    InstanceSettingsModule,
  ],
  providers: [
    { provide: AGENT_RUNTIME, useClass: MastraAgentRuntime },
    AgentActivityService,
    BrowserService,
  ],
  exports: [AGENT_RUNTIME, AgentActivityService],
})
export class AgentModule {}

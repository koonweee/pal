import { DeliveryModule } from '../delivery/delivery.module.js';
import { BrowserModule } from '../browser/browser.module.js';
import { LoginModule } from '../login/login.module.js';
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
    BrowserModule,
    LoginModule,
    ChatModule,
    TasksModule,
    FilesModule,
    PreferencesModule,
    InstanceSettingsModule,
  ],
  providers: [
    { provide: AGENT_RUNTIME, useClass: MastraAgentRuntime },
    AgentActivityService,
  ],
  exports: [AGENT_RUNTIME, AgentActivityService],
})
export class AgentModule {}

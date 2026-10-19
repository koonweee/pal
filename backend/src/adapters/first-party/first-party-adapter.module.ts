import { Module } from '@nestjs/common';
import { InstanceSettingsModule } from '../../instance-settings/instance-settings.module.js';
import { FirstPartyInstanceSettingsController } from './instance-settings.controller.js';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AgentModule } from '../../agent/agent.module.js';
import { ApplicationModule } from '../../application/application.module.js';
import { ChatModule } from '../../chat/chat.module.js';
import { FilesModule } from '../../files/files.module.js';
import { DeliveryModule } from '../../delivery/delivery.module.js';
import { McpModule } from '../../mcp/mcp.module.js';
import { PreferencesModule } from '../../preferences/preferences.module.js';
import { TasksModule } from '../../tasks/tasks.module.js';
import { FirstPartyChatController } from './chat.controller.js';
import {
  FirstPartyFilesController,
  MultipartUploadAdapter,
} from './files.controller.js';
import { FirstPartyMcpController } from './mcp.controller.js';
import { FirstPartyPreferencesController } from './preferences.controller.js';
import { FirstPartyStreamController } from './stream.controller.js';
import { FirstPartyTasksController } from './tasks.controller.js';
import { ApplicationErrorFilter } from './application-error.filter.js';
import { BrowserOriginGuard } from './browser-origin.guard.js';
import { HealthController } from './health.controller.js';
import { FirstPartyContractInterceptor } from './first-party-contract.interceptor.js';
export { FIRST_PARTY_CONTRACT_VERSION } from './first-party-contract.js';

/**
 * Registers the client-facing HTTP/SSE protocol. New canonical clients consume
 * this wire contract; Pal application modules never import this adapter.
 *
 * @example
 * A canonical app posts `destinationId: "ios"`, opens `/stream` before loading
 * snapshots, buffers changes during the load, and merges entities by ID/version.
 */
@Module({
  imports: [
    AgentModule,
    InstanceSettingsModule,
    ApplicationModule,
    ChatModule,
    FilesModule,
    DeliveryModule,
    McpModule,
    PreferencesModule,
    TasksModule,
  ],
  controllers: [
    HealthController,
    FirstPartyInstanceSettingsController,
    FirstPartyChatController,
    FirstPartyFilesController,
    FirstPartyMcpController,
    FirstPartyPreferencesController,
    FirstPartyStreamController,
    FirstPartyTasksController,
  ],
  providers: [
    MultipartUploadAdapter,
    { provide: APP_FILTER, useClass: ApplicationErrorFilter },
    { provide: APP_GUARD, useClass: BrowserOriginGuard },
    { provide: APP_INTERCEPTOR, useClass: FirstPartyContractInterceptor },
  ],
})
export class FirstPartyAdapterModule {}

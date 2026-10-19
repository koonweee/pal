import { Module } from '@nestjs/common';
import { InstanceSettingsService } from '../../instance-settings/instance-settings.service.js';
import { FirstPartyInstanceSettingsController } from './instance-settings.controller.js';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AgentActivityService } from '../../agent/agent-activity.service.js';
import { ChatCoordinatorService } from '../../application/chat-coordinator.service.js';
import { ChatService } from '../../chat/chat.service.js';
import { DestinationService } from '../../delivery/destination.service.js';
import { EventsService } from '../../events/events.service.js';
import { FilesService } from '../../files/files.service.js';
import { McpService } from '../../mcp/mcp.service.js';
import { PreferencesService } from '../../preferences/preferences.service.js';
import { TasksService } from '../../tasks/tasks.service.js';
import { FirstPartyChatController } from './chat.controller.js';
import {
  FirstPartyFilesController,
  MultipartUploadAdapter,
} from './files.controller.js';
import { HealthController } from './health.controller.js';
import { FirstPartyMcpController } from './mcp.controller.js';
import { FirstPartyPreferencesController } from './preferences.controller.js';
import { FirstPartyStreamController } from './stream.controller.js';
import { FirstPartyTasksController } from './tasks.controller.js';
import { FIRST_PARTY_CONTRACT_VERSION } from './first-party-contract.js';

import { WebPushController } from '../web-push/web-push.controller.js';
import { WebPushService } from '../web-push/web-push.service.js';

const stub = { provide: Object, useValue: {} };

@Module({
  controllers: [
    HealthController,
    WebPushController,
    FirstPartyInstanceSettingsController,
    FirstPartyChatController,
    FirstPartyFilesController,
    FirstPartyMcpController,
    FirstPartyPreferencesController,
    FirstPartyStreamController,
    FirstPartyTasksController,
  ],
  providers: [
    InstanceSettingsService,
    WebPushService,
    ChatService,
    ChatCoordinatorService,
    DestinationService,
    EventsService,
    FilesService,
    MultipartUploadAdapter,
    McpService,
    PreferencesService,
    TasksService,
    AgentActivityService,
    ConfigService,
  ].map((provide) => ({ ...stub, provide })),
})
class FirstPartyOpenApiModule {}

export async function createFirstPartyOpenApiDocument() {
  const app = await NestFactory.create(FirstPartyOpenApiModule, {
    logger: false,
  });
  try {
    return SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Pal First-party API')
        .setDescription(
          'Private single-owner HTTP and SSE contract for canonical Pal clients.',
        )
        .setVersion(String(FIRST_PARTY_CONTRACT_VERSION))
        .build(),
      { operationIdFactory: (_controller, method) => method },
    );
  } finally {
    await app.close();
  }
}

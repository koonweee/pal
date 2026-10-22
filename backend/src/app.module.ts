import { ExecutionModule } from './execution/execution.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { ApplicationModule } from './application/application.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { FirstPartyAdapterModule } from './adapters/first-party/first-party-adapter.module.js';
import { SecondaryAdapterModule } from './adapters/secondary/secondary-adapter.module.js';
import { TelegramAdapterModule } from './adapters/telegram/telegram-adapter.module.js';
import { NativeNotificationAdapterModule } from './adapters/notifications/native-notification-adapter.module.js';
import { WebPushModule } from './adapters/web-push/web-push.module.js';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ExecutionModule,
    DatabaseModule,
    EventsModule,
    McpModule,
    ApplicationModule,
    FirstPartyAdapterModule,
    SecondaryAdapterModule,
    TelegramAdapterModule,
    NativeNotificationAdapterModule,
    WebPushModule,
  ],
})
export class AppModule {}

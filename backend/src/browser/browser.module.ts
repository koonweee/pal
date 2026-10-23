import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { BrowserService } from './browser.service.js';
@Module({
  imports: [TasksModule],
  providers: [BrowserService],
  exports: [BrowserService],
})
export class BrowserModule {}

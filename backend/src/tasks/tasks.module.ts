import { TaskSchedulesService } from './task-schedules.service.js';
import { Module } from '@nestjs/common';
import { TasksRepository } from './tasks.repository.js';
import { TasksService } from './tasks.service.js';
@Module({
  providers: [TasksRepository, TasksService, TaskSchedulesService],
  exports: [TasksRepository, TasksService, TaskSchedulesService],
})
export class TasksModule {}

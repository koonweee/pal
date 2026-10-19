import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import type { Mastra } from '@mastra/core/mastra';
import type { AgentSchedule, AnySchedule } from '@mastra/core/schedules';
import {
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '@mastra/core/request-context';
import { TasksService } from './tasks.service.js';

const AGENT_ID = 'pal-task-agent';
const OWNER_ID = 'pal-owner';
const threadId = (taskId: string) => 'pal-task:' + taskId;

export interface ScheduleInput {
  cron: string;
  timezone: string;
  prompt: string;
}

@Injectable()
export class TaskSchedulesService {
  private mastra?: Mastra;

  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  // The runtime binds its native store after agents are registered.
  async bind(mastra: Mastra) {
    this.mastra = mastra;
    // Normalize persisted Task wake attributes through the native schedule API.
    for (const schedule of await this.schedules.list({
      agentId: AGENT_ID,
      resourceId: OWNER_ID,
    })) {
      if (schedule.agentId !== AGENT_ID) continue;
      const { participantDestinationIds, deliveryChannels, ...attributes } =
        schedule.attributes ?? {};
      if (
        participantDestinationIds !== undefined ||
        deliveryChannels !== undefined ||
        schedule.ifIdle?.attributes?.executionStart !== true
      )
        await this.schedules.update(schedule.id, {
          attributes,
          ifIdle: {
            ...schedule.ifIdle,
            attributes: {
              ...schedule.ifIdle?.attributes,
              executionStart: true,
            },
          },
        });
    }
  }

  private get schedules() {
    if (!this.mastra) throw new Error('Task schedules are unavailable');
    return this.mastra.schedules;
  }

  private view(schedule: AnySchedule, taskId: string) {
    return {
      id: schedule.id,
      taskId,
      prompt: 'prompt' in schedule ? schedule.prompt : undefined,
      cron: schedule.cron,
      timezone: schedule.timezone,
      status: schedule.status,
      nextFireAt: new Date(schedule.nextFireAt).toISOString(),
    };
  }

  private async owned(taskId: string, id: string): Promise<AgentSchedule> {
    await this.tasks.details(taskId);
    const schedule = await this.schedules.get(id);
    if (
      !schedule ||
      schedule.agentId !== AGENT_ID ||
      schedule.threadId !== threadId(taskId) ||
      schedule.resourceId !== OWNER_ID
    )
      throw new ApplicationError('not_found', 'Task schedule not found');
    return schedule;
  }

  async create(taskId: string, input: ScheduleInput) {
    await this.tasks.details(taskId);
    const id = 'agent_' + randomUUID();
    const schedule = await this.schedules.create({
      ...input,
      id,
      agentId: AGENT_ID,
      threadId: threadId(taskId),
      resourceId: OWNER_ID,
      signalType: 'reactive',
      tagName: 'scheduled-execution',
      attributes: {
        source: 'automation',
        scheduleId: id,
        taskId,
      },
      ifActive: { behavior: 'deliver' },
      ifIdle: {
        behavior: 'wake',
        attributes: { executionStart: true },
        streamOptions: {
          requestContext: {
            [MASTRA_THREAD_ID_KEY]: threadId(taskId),
            [MASTRA_RESOURCE_ID_KEY]: OWNER_ID,
            palScheduledExecution: true,
          },
        },
      },
    });
    return this.view(schedule, taskId);
  }

  async list(taskId: string) {
    await this.tasks.details(taskId);
    return (
      await this.schedules.list({
        agentId: AGENT_ID,
        threadId: threadId(taskId),
        resourceId: OWNER_ID,
      })
    ).map((schedule) => this.view(schedule, taskId));
  }

  async update(taskId: string, id: string, input: Partial<ScheduleInput>) {
    await this.owned(taskId, id);
    return this.view(await this.schedules.update(id, input), taskId);
  }

  async pause(taskId: string, id: string) {
    await this.owned(taskId, id);
    return this.view(await this.schedules.pause(id), taskId);
  }

  async resume(taskId: string, id: string) {
    await this.owned(taskId, id);
    return this.view(await this.schedules.resume(id), taskId);
  }

  async delete(taskId: string, id: string) {
    await this.owned(taskId, id);
    await this.schedules.delete(id);
    return { id, deleted: true };
  }
}

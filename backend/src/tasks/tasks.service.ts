import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import { isUUID } from 'class-validator';
import { DatabaseService } from '../database/database.service.js';
import { EventsService } from '../events/events.service.js';
import { TasksRepository, taskView } from './tasks.repository.js';
import type {
  CreateTask,
  DetailedTask,
  TaskStatus,
  TaskSearchInput,
  TaskSearchCursor,
} from './tasks.types.js';
@Injectable()
export class TasksService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TasksRepository) private readonly repository: TasksRepository,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}
  activityTasks() {
    return this.repository.activityTasks();
  }
  validate(input: CreateTask) {
    if (!input.title.trim() || !input.goal.trim())
      throw new ApplicationError(
        'invalid_input',
        'Task title and goal are required',
      );
  }
  async create(input: CreateTask) {
    this.validate(input);
    const row = await this.database.transaction((tx) =>
      this.repository.create(
        {
          title: input.title,
          goal: input.goal,
          description: input.description ?? '',
        },
        tx,
      ),
    );
    const task = taskView(row);
    this.events.publish({ event: 'task.added', task });
    return task;
  }
  async details(id: string): Promise<DetailedTask> {
    const row = await this.repository.get(id);
    if (!row) throw new ApplicationError('not_found', 'Task not found');
    return { ...taskView(row), description: row.description };
  }

  async update(
    id: string,
    input: {
      title?: string;
      goal?: string;
      description?: string;
      status?: TaskStatus;
      archived?: boolean;
    },
  ) {
    if (
      (input.title !== undefined && !input.title.trim()) ||
      (input.goal !== undefined && !input.goal.trim())
    )
      throw new ApplicationError(
        'invalid_input',
        'Task title and goal must be nonempty',
      );
    const row = await this.database.transaction(async (tx) => {
      if (!(await this.repository.lock(id, tx)))
        throw new ApplicationError('not_found', 'Task not found');
      return this.repository.update(id, input, tx);
    });
    const task = taskView(row);
    this.events.publish({ event: 'task.updated', task });
    return task;
  }
  async search(input: TaskSearchInput) {
    if (
      !Array.isArray(input.queries) ||
      !input.queries.length ||
      input.queries.length > 5 ||
      input.queries.some(
        (q) => typeof q !== 'string' || !q.trim() || q.length > 200,
      )
    )
      throw new ApplicationError(
        'invalid_input',
        'Provide 1 to 5 nonempty queries of at most 200 characters',
      );
    const queries = [
      ...new Set(
        input.queries.map((q) => q.trim().toLowerCase().replace(/\s+/g, ' ')),
      ),
    ].sort();
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new ApplicationError(
        'invalid_input',
        'Search limit must be between 1 and 20',
      );
    let cursor: TaskSearchCursor | undefined;
    if (input.after) {
      try {
        const value: unknown = JSON.parse(
          Buffer.from(input.after, 'base64url').toString(),
        );
        if (
          !value ||
          typeof value !== 'object' ||
          !('id' in value) ||
          typeof value.id !== 'string' ||
          !isUUID(value.id) ||
          !('createdAt' in value) ||
          typeof value.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(value.createdAt)) ||
          new Date(value.createdAt).toISOString() !== value.createdAt ||
          !('queries' in value) ||
          JSON.stringify(value.queries) !== JSON.stringify(queries)
        )
          throw new Error();
        cursor = {
          queries,
          id: value.id,
          createdAt: value.createdAt,
        };
      } catch {
        throw new ApplicationError('invalid_input', 'Invalid search cursor');
      }
    }
    const rows = await this.repository.search(queries, limit, cursor);
    const page = rows.slice(0, limit);
    const terms = queries.flatMap((query) => query.split(' '));
    const excerpt = (text: string) => {
      const positions = terms
        .map((term) => text.toLowerCase().indexOf(term))
        .filter((i) => i >= 0);
      if (!positions.length) return null;
      const start = Math.max(0, Math.min(...positions) - 60);
      return (
        (start ? '…' : '') +
        text.slice(start, start + 240) +
        (start + 240 < text.length ? '…' : '')
      );
    };
    const last = page.at(-1);
    return {
      tasks: page.map((row) => ({
        id: row.id,
        title:
          row.title.length > 120 ? row.title.slice(0, 119) + '…' : row.title,
        goal: row.goal.length > 240 ? row.goal.slice(0, 239) + '…' : row.goal,
        status: row.status,
        archived: row.archived,
        descriptionExcerpt: excerpt(row.description),
      })),
      after:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                queries,
                createdAt: last.createdAt.toISOString(),
                id: last.id,
              } satisfies TaskSearchCursor),
            ).toString('base64url')
          : null,
    };
  }
  async list(options: { after?: string; archived?: boolean; limit?: number }) {
    let cursor: { lastActivityAt: string; id: string } | undefined;
    if (options.after) {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(options.after, 'base64url').toString(),
        );
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('lastActivityAt' in parsed) ||
          !('id' in parsed) ||
          typeof parsed.lastActivityAt !== 'string' ||
          typeof parsed.id !== 'string' ||
          !isUUID(parsed.id) ||
          !Number.isFinite(Date.parse(parsed.lastActivityAt)) ||
          new Date(parsed.lastActivityAt).toISOString() !==
            parsed.lastActivityAt
        )
          throw new Error();
        cursor = { lastActivityAt: parsed.lastActivityAt, id: parsed.id };
      } catch {
        throw new ApplicationError('invalid_input', 'Invalid task cursor');
      }
    }
    const limit = options.limit ?? 20;
    const rows = await this.repository.list(
      options.archived ?? false,
      limit,
      cursor,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      tasks: page.map(taskView),
      after:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                lastActivityAt: last.lastActivityAt.toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
  }
}

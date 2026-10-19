import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import type { Task } from '../tasks/tasks.types.js';
import type {
  ActivityCommentary,
  AgentActivityState,
} from '../events/events.types.js';

type TaskSummary = Pick<
  Task,
  'id' | 'title' | 'status' | 'archived' | 'version'
>;

@Injectable()
export class AgentActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly runs = new Map<
    string,
    { taskId?: string; commentary: ActivityCommentary | null }
  >();
  private readonly tasks = new Map<string, TaskSummary>();
  private readonly pendingCompletions = new Set<string>();
  private revision = 0;
  private latestCompletion: AgentActivityState['latestCompletion'] = null;
  private readonly subscription;

  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(TasksService) private readonly taskService: TasksService,
  ) {
    this.subscription = events.changes.subscribe((event) => {
      if (event.event === 'task.added' || event.event === 'task.updated')
        this.observeTask(event.task);
    });
  }

  async onModuleInit() {
    // Subscribe before loading; newer committed events win over this read.
    for (const task of await this.taskService.activityTasks()) {
      const current = this.tasks.get(task.id);
      if (!current || current.version < task.version)
        this.tasks.set(task.id, task);
    }
    this.publish();
  }

  onModuleDestroy() {
    this.subscription.unsubscribe();
  }

  current(): AgentActivityState {
    const running = new Map<
      string,
      { id: string; title: string; commentary: ActivityCommentary | null }
    >();
    for (const run of this.runs.values()) {
      if (!run.taskId) continue;
      const existing = running.get(run.taskId);
      const commentary =
        !existing?.commentary ||
        (run.commentary &&
          run.commentary.sequence > existing.commentary.sequence)
          ? run.commentary
          : existing.commentary;
      running.set(run.taskId, {
        id: run.taskId,
        title: this.tasks.get(run.taskId)?.title ?? '',
        commentary,
      });
    }
    return {
      revision: this.revision,
      status: this.runs.size ? 'working' : 'idle',
      mainWorking: this.runs.has('main'),
      runningTasks: [...running.values()],
      needsInputTasks: [...this.tasks.values()]
        .filter((task) => !task.archived && task.status === 'needs-input')
        .map(({ id, title }) => ({ id, title })),
      latestCompletion: this.latestCompletion,
    };
  }

  setWorking(working: boolean) {
    this.setRunWorking('main', working);
  }

  setRunWorking(
    id: string,
    working: boolean,
    taskId?: string,
    interrupted = false,
  ) {
    if (working) {
      if (this.runs.has(id)) return;
      this.runs.set(id, { taskId, commentary: null });
      if (taskId && this.latestCompletion?.id === taskId)
        this.latestCompletion = null;
    } else {
      const run = this.runs.get(id);
      if (!run) return;
      this.runs.delete(id);
      if (run.taskId) {
        if (interrupted) this.pendingCompletions.delete(run.taskId);
        else this.completeWhenIdle(run.taskId);
      }
    }
    this.publish();
  }

  commentary(runId: string, taskId: string, message: ActivityCommentary) {
    const run = this.runs.get(runId);
    if (
      !run ||
      run.taskId !== taskId ||
      !message.text.trim() ||
      (run.commentary && run.commentary.sequence >= message.sequence)
    )
      return;
    run.commentary = message;
    this.publish();
  }

  private observeTask(task: TaskSummary) {
    const previous = this.tasks.get(task.id);
    if (previous && previous.version >= task.version) return;
    this.tasks.set(task.id, {
      id: task.id,
      title: task.title,
      status: task.status,
      archived: task.archived,
      version: task.version,
    });
    if (
      !task.archived &&
      previous &&
      previous.status !== 'completed' &&
      task.status === 'completed'
    )
      this.pendingCompletions.add(task.id);
    if (task.archived || task.status !== 'completed')
      this.pendingCompletions.delete(task.id);
    if (this.latestCompletion?.id === task.id) {
      if (task.archived || task.status !== 'completed')
        this.latestCompletion = null;
      else
        this.latestCompletion = { ...this.latestCompletion, title: task.title };
    }
    this.completeWhenIdle(task.id);
    if (
      previous?.title !== task.title ||
      previous?.status !== task.status ||
      previous?.archived !== task.archived
    )
      this.publish();
  }

  private completeWhenIdle(taskId: string) {
    const task = this.tasks.get(taskId);
    if (
      !this.pendingCompletions.has(taskId) ||
      !task ||
      task.archived ||
      task.status !== 'completed' ||
      [...this.runs.values()].some((run) => run.taskId === taskId)
    )
      return;
    this.pendingCompletions.delete(taskId);
    this.latestCompletion = {
      id: task.id,
      title: task.title,
      cueId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
  }

  private publish() {
    this.revision++;
    this.events.publish({ event: 'agent.activity', state: this.current() });
  }

  reset() {
    this.runs.clear();
    this.tasks.clear();
    this.pendingCompletions.clear();
    this.latestCompletion = null;
    this.publish();
  }
}

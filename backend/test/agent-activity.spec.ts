import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
import { EventsService } from '../dist/events/events.service.js';
import type { TasksService } from '../dist/tasks/tasks.service.js';
import type { Task } from '../dist/tasks/tasks.types.js';

const task = (
  id: string,
  status: Task['status'] = 'in-progress',
  version = 1,
): Task => ({
  id,
  title: id,
  goal: id,
  status,
  version,
  archived: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
});

it('tracks distinct task runs independently of Main and rejects late commentary', async () => {
  const events = new EventsService();
  const activity = new AgentActivityService(events, {
    activityTasks: async () => [task('a'), task('b')],
  } as unknown as TasksService);
  await activity.onModuleInit();
  const snapshots: unknown[] = [];
  const sub = events.changes.subscribe((event) => {
    if (event.event === 'agent.activity') snapshots.push(event.state);
  });
  activity.setWorking(true);
  activity.setRunWorking('run-a', true, 'a');
  activity.setRunWorking('run-b', true, 'b'); // scheduled and direct runs use the same lifecycle input
  activity.setRunWorking('run-a-2', true, 'a');
  expect(activity.current()).toMatchObject({
    mainWorking: true,
    runningTasks: [{ id: 'a' }, { id: 'b' }],
  });
  expect(snapshots).toHaveLength(4);
  activity.commentary('run-a', 'a', {
    messageId: 'message-1',
    sequence: 1,
    text: 'checking…',
  });
  expect(activity.current().runningTasks[0]?.commentary?.text).toBe(
    'checking…',
  );
  activity.setRunWorking('run-a', false);
  activity.commentary('run-a', 'a', {
    messageId: 'late',
    sequence: 2,
    text: 'stale',
  });
  expect(activity.current().runningTasks[0]?.commentary).toBeNull();
  activity.setRunWorking('run-a-2', false);
  activity.setRunWorking('run-b', false);
  expect(activity.current()).toMatchObject({
    status: 'working',
    runningTasks: [],
  });
  activity.setWorking(false);
  expect(activity.current().status).toBe('idle');
  sub.unsubscribe();
  activity.onModuleDestroy();
});

it('rebuilds complete pending-input state without replaying completion and newer events beat startup reads', async () => {
  const events = new EventsService();
  let resolve!: (rows: Task[]) => void;
  const activity = new AgentActivityService(events, {
    activityTasks: () =>
      new Promise<Task[]>((done) => {
        resolve = done;
      }),
  } as unknown as TasksService);
  const loading = activity.onModuleInit();
  events.publish({
    event: 'task.updated',
    task: { ...task('a', 'needs-input', 2), archived: true },
  });
  resolve([
    task('a', 'needs-input'),
    ...Array.from({ length: 25 }, (_, index) =>
      task('pending-' + index, 'needs-input'),
    ),
  ]);
  await loading;
  expect(activity.current().needsInputTasks).toHaveLength(25);
  expect(activity.current().latestCompletion).toBeNull();
  events.publish({
    event: 'task.updated',
    task: task('pending-0', 'completed', 2),
  });
  const cue = activity.current().latestCompletion;
  expect(cue).toMatchObject({ id: 'pending-0' });
  events.publish({
    event: 'task.updated',
    task: task('pending-0', 'completed', 3),
  });
  expect(activity.current().latestCompletion?.cueId).toBe(cue?.cueId);
  events.publish({
    event: 'task.updated',
    task: { ...task('pending-0', 'completed', 4), archived: true },
  });
  expect(activity.current().latestCompletion).toBeNull();
  activity.reset();
  expect(activity.current()).toMatchObject({
    runningTasks: [],
    needsInputTasks: [],
    latestCompletion: null,
  });
  activity.onModuleDestroy();
});

it('starts completion when the last completed task run settles while other work continues', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T20:00:00Z'));
  const events = new EventsService();
  const activity = new AgentActivityService(events, {
    activityTasks: async () => [task('a'), task('b')],
  } as unknown as TasksService);
  try {
    await activity.onModuleInit();
    activity.setWorking(true);
    activity.setRunWorking('a-1', true, 'a');
    activity.setRunWorking('a-2', true, 'a');
    activity.setRunWorking('b-1', true, 'b');
    events.publish({ event: 'task.updated', task: task('a', 'completed', 2) });
    expect(activity.current().latestCompletion).toBeNull();
    vi.advanceTimersByTime(45_000);
    activity.setRunWorking('a-1', false);
    expect(activity.current().latestCompletion).toBeNull();
    activity.setRunWorking('a-2', false);
    expect(activity.current()).toMatchObject({
      mainWorking: true,
      runningTasks: [{ id: 'b' }],
      latestCompletion: {
        id: 'a',
        occurredAt: new Date().toISOString(),
      },
    });
    const cue = activity.current().latestCompletion;
    activity.setRunWorking('a-2', false);
    expect(activity.current().latestCompletion?.cueId).toBe(cue?.cueId);
    activity.setRunWorking('b-1', false);
    expect(activity.current().latestCompletion?.cueId).toBe(cue?.cueId);
  } finally {
    activity.onModuleDestroy();
    vi.useRealTimers();
  }
});

it('discards armed completion when work is interrupted, reopened, or archived', async () => {
  const events = new EventsService();
  const activity = new AgentActivityService(events, {
    activityTasks: async () => [task('a'), task('b'), task('c')],
  } as unknown as TasksService);
  await activity.onModuleInit();
  try {
    for (const id of ['a', 'b', 'c']) {
      activity.setRunWorking(id, true, id);
      events.publish({ event: 'task.updated', task: task(id, 'completed', 2) });
    }
    activity.setRunWorking('a', false, 'a', true);
    events.publish({
      event: 'task.updated',
      task: task('b', 'in-progress', 3),
    });
    events.publish({
      event: 'task.updated',
      task: { ...task('c', 'completed', 3), archived: true },
    });
    activity.setRunWorking('b', false);
    activity.setRunWorking('c', false);
    expect(activity.current().latestCompletion).toBeNull();
    activity.setRunWorking('unfinished', true, 'b');
    activity.setRunWorking('unfinished', false);
    expect(activity.current().latestCompletion).toBeNull();
  } finally {
    activity.onModuleDestroy();
  }
});

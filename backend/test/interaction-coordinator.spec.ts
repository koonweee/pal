import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';

const begin = (
  coordinator: InteractionCoordinator,
  id: string,
  parent = 'parent',
) => coordinator.begin({ taskId: 'same-task', workerId: id }, parent);

it('admits FIFO turns, serializes owner calls, and binds each execution to one device', async () => {
  const coordinator = new InteractionCoordinator();
  const first = begin(coordinator, 'first');
  const gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  const a = coordinator.run('desktop', first, async () => {
    calls.push('first');
    await gate.promise;
  });
  const b = coordinator.run('desktop', first, async () => {
    calls.push('second-call');
  });
  const queued = Array.from({ length: 10 }, (_, index) => {
    const id = begin(coordinator, String(index));
    const result = coordinator.run('desktop', id, async () => {
      calls.push(String(index));
    });
    return { id, result };
  });
  const android = begin(coordinator, 'phone');
  await coordinator.run('android', android, async () => {
    calls.push('phone');
  });
  expect(calls).toEqual(['first', 'phone']);
  expect(coordinator.snapshot()[0].waiting).toHaveLength(10);
  await expect(
    coordinator.run('android', first, async () => {}),
  ).rejects.toThrow('fresh worker');
  gate.resolve();
  await Promise.all([a, b]);
  expect(calls).toEqual(['first', 'phone', 'second-call']);
  await coordinator.finish(first);
  for (const { id, result } of queued) {
    await result;
    await coordinator.finish(id);
  }
  expect(calls.slice(3)).toEqual(
    Array.from({ length: 10 }, (_, index) => String(index)),
  );
  await coordinator.shutdown();
});

it('cancels waiters and drains dispatched calls before handoff, fencing ended executions', async () => {
  const coordinator = new InteractionCoordinator();
  const first = begin(coordinator, 'first');
  const gate = Promise.withResolvers<void>();
  const abort = new AbortController();
  const active = coordinator.run(
    'desktop',
    first,
    () => gate.promise,
    abort.signal,
  );
  await Promise.resolve();
  await Promise.resolve();
  const cancelled = begin(coordinator, 'cancelled');
  const pending = coordinator.run('desktop', cancelled, async () => {
    throw new Error('must not dispatch');
  });
  const rejected = expect(pending).rejects.toThrow('ended');
  await coordinator.finish(cancelled);
  await rejected;
  const next = begin(coordinator, 'next', 'other');
  const action = vi.fn(async () => {});
  const waiting = coordinator.run('desktop', next, action);
  abort.abort();
  const release = coordinator.finish(first);
  expect(action).not.toHaveBeenCalled();
  await expect(
    coordinator.run('desktop', first, async () => {}),
  ).rejects.toThrow('ended');
  gate.resolve();
  await Promise.all([active, release, waiting]);
  expect(action).toHaveBeenCalledOnce();
  await coordinator.finishParent('other');
  expect(coordinator.snapshot()[0].owner).toBeNull();
  await coordinator.shutdown();
});

it('keeps uncertain resources unavailable and permits nested private operations without deadlock', async () => {
  const coordinator = new InteractionCoordinator();
  const identity = { taskId: 'task', workerId: 'session' };
  const first = coordinator.begin(identity);
  await coordinator.run('desktop', first, () =>
    coordinator.forSession('desktop', identity, async () => 'filled'),
  );
  coordinator.unavailable('desktop');
  await coordinator.finish(first);
  await expect(
    coordinator.forSession('desktop', identity, async () => {}),
  ).rejects.toThrow('uncertain');
  await coordinator.forSession('android', identity, async () => {});
  await coordinator.shutdown();
});

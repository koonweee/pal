import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';

const begin = (
  coordinator: InteractionCoordinator,
  id: string,
  parent = 'parent',
) => coordinator.begin({ taskId: 'same-task', workerId: id }, parent);

it('queues external private submissions behind existing waiters even when their session still owns the device', async () => {
  const coordinator = new InteractionCoordinator();
  const identity = { taskId: 'task', workerId: 'session' };
  const original = coordinator.begin(identity, 'parent');
  const next = begin(coordinator, 'next');
  await coordinator.run('desktop', original, async () => {});
  const order: string[] = [];
  const waiting = coordinator.run('desktop', next, async () => {
    order.push('next');
  });
  const submission = coordinator.forSession('desktop', identity, async () => {
    order.push('submission');
  });
  expect(coordinator.snapshot()[0].waiting).toHaveLength(2);
  coordinator.finish(original);
  await waiting;
  expect(order).toEqual(['next']);
  coordinator.finish(next);
  await submission;
  expect(order).toEqual(['next', 'submission']);
  expect(coordinator.snapshot()[0].owner).toBeNull();
});

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
  coordinator.finish(first);
  for (const { id, result } of queued) {
    await result;
    coordinator.finish(id);
  }
  expect(calls.slice(3)).toEqual(
    Array.from({ length: 10 }, (_, index) => String(index)),
  );
  coordinator.shutdown();
});

it.each(['success', 'error'] as const)(
  'hands off before dispatched work settles with late %s and rejects retired calls',
  async (outcome) => {
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
    const result = active.then(
      () => 'success',
      () => 'error',
    );
    await Promise.resolve();
    await Promise.resolve();
    const cancelled = begin(coordinator, 'cancelled');
    const pending = coordinator.run('desktop', cancelled, async () => {
      throw new Error('must not dispatch');
    });
    const rejected = expect(pending).rejects.toThrow('ended');
    coordinator.finish(cancelled);
    await rejected;
    const next = begin(coordinator, 'next', 'other');
    const queuedOld = expect(
      coordinator.run('desktop', first, async () => {
        throw new Error('retired call must not dispatch');
      }),
    ).rejects.toThrow('ended');
    const action = vi.fn(async () => {});
    const waiting = coordinator.run('desktop', next, action);
    abort.abort();
    coordinator.finish(first);
    await waiting;
    expect(action).toHaveBeenCalledOnce();
    expect(coordinator.snapshot()[0].owner?.executionId).toBe(next);
    await expect(
      coordinator.run('desktop', first, async () => {}),
    ).rejects.toThrow('ended');
    if (outcome === 'success') gate.resolve();
    else gate.reject(new Error('late failure'));
    expect(await result).toBe(outcome);
    await queuedOld;
    coordinator.finish(first);
    expect(coordinator.snapshot()[0].owner?.executionId).toBe(next);
    coordinator.finishParent('other');
    expect(coordinator.snapshot()[0].owner).toBeNull();
    coordinator.shutdown();
  },
);

it('permits nested private operations and fresh external turns without deadlock', async () => {
  const coordinator = new InteractionCoordinator();
  const identity = { taskId: 'task', workerId: 'session' };
  const first = coordinator.begin(identity);
  await coordinator.run('desktop', first, () =>
    coordinator.forSession('desktop', identity, async () => 'filled'),
  );
  coordinator.finish(first);
  await coordinator.forSession('desktop', identity, async () => {});
  await coordinator.forSession('android', identity, async () => {});
  coordinator.shutdown();
});

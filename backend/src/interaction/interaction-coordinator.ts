import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type InteractionResource = 'desktop' | 'android';
export interface InteractionIdentity {
  taskId: string;
  workerId: string;
}
export interface InteractionParticipant extends InteractionIdentity {
  executionId: string;
}
export interface InteractionSnapshot {
  resource: InteractionResource;
  owner: InteractionParticipant | null;
  waiting: InteractionParticipant[];
  unavailable: boolean;
}
interface Execution extends InteractionParticipant {
  queuedAt?: number;
  acquiredAt?: number;
  parentRunId?: string;
  resource?: InteractionResource;
  granted: {
    promise: Promise<void>;
    resolve(): void;
    reject(error: Error): void;
  };
  pending: Promise<void>;
  ending: boolean;
  finished?: Promise<void>;
  listeners: Map<AbortSignal, () => void>;
}
interface Resource {
  owner?: Execution;
  waiting: Execution[];
  unavailable: boolean;
}

/** Local device admission; device adapters own transport settlement and readiness. */
@Injectable()
export class InteractionCoordinator {
  private readonly executions = new Map<string, Execution>();
  private readonly operations = new AsyncLocalStorage<Execution>();
  private readonly resources: Record<InteractionResource, Resource> = {
    desktop: { waiting: [], unavailable: false },
    android: { waiting: [], unavailable: false },
  };
  private closing = false;
  readonly changes = new Subject<InteractionSnapshot[]>();
  readonly events = new Subject<{
    event: 'queued' | 'acquired' | 'released' | 'unavailable';
    resource: InteractionResource;
    taskId?: string;
    workerId?: string;
    executionId?: string;
    parentRunId?: string;
    durationMs?: number;
  }>();

  begin(identity: InteractionIdentity, parentRunId?: string) {
    if (this.closing) throw new Error('Interaction service is stopping');
    const executionId = randomUUID();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const granted = { promise, resolve, reject };
    // A cancelled queued execution may not yet have reached its await.
    void granted.promise.catch(() => {});
    this.executions.set(executionId, {
      ...identity,
      executionId,
      parentRunId,
      granted,
      pending: Promise.resolve(),
      ending: false,
      listeners: new Map(),
    });
    return executionId;
  }

  snapshot(): InteractionSnapshot[] {
    const participant = (entry: Execution): InteractionParticipant => ({
      taskId: entry.taskId,
      workerId: entry.workerId,
      executionId: entry.executionId,
    });
    return (
      Object.entries(this.resources) as [InteractionResource, Resource][]
    ).map(([resource, state]) => ({
      resource,
      owner: state.owner ? participant(state.owner) : null,
      waiting: state.waiting.map(participant),
      unavailable: state.unavailable,
    }));
  }

  resourceFor(executionId: string) {
    const execution = this.executions.get(executionId);
    if (!execution || execution.ending)
      throw new Error('Interaction execution has ended');
    return execution.resource;
  }

  private publish() {
    this.changes.next(this.snapshot());
  }

  async run<T>(
    resource: InteractionResource,
    executionId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const execution = this.executions.get(executionId);
    if (!execution || execution.ending || this.closing)
      throw new Error('Interaction execution has ended');
    if (execution.resource && execution.resource !== resource)
      throw new Error(
        'This worker is bound to ' +
          execution.resource +
          '. Return findings to Task so a fresh worker can use ' +
          resource +
          '.',
      );
    const state = this.resources[resource];
    const firstCall = !execution.resource;
    execution.resource = resource;
    if (state.unavailable)
      throw new Error(
        resource + ' is unavailable after an uncertain operation',
      );
    if (signal && !execution.listeners.has(signal)) {
      const abort = () => {
        void this.finish(executionId);
      };
      execution.listeners.set(signal, abort);
      signal.addEventListener('abort', abort, { once: true });
    }
    // Private operations may call a device adapter while already inside a grant.
    if (this.operations.getStore() === execution) return operation();
    if (firstCall) {
      execution.queuedAt = Date.now();
      state.waiting.push(execution);
      this.events.next({
        event: 'queued',
        resource,
        taskId: execution.taskId,
        workerId: execution.workerId,
        executionId,
        parentRunId: execution.parentRunId,
      });
      this.advance(state);
      this.publish();
    }
    const pending = execution.pending.then(async () => {
      await execution.granted.promise;
      signal?.throwIfAborted();
      if (execution.ending || state.owner !== execution)
        throw new Error('Interaction execution has ended');
      return this.operations.run(execution, operation);
    });
    execution.pending = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  /** Nested worker operations reuse their turn; external submissions queue afresh. */
  async forSession<T>(
    resource: InteractionResource,
    identity: InteractionIdentity,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const current = this.operations.getStore();
    if (
      current?.taskId === identity.taskId &&
      current.workerId === identity.workerId
    )
      return this.run(resource, current.executionId, operation, signal);
    const executionId = this.begin(identity);
    try {
      return await this.run(resource, executionId, operation, signal);
    } finally {
      await this.finish(executionId);
    }
  }

  finish(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) return Promise.resolve();
    if (execution.finished) return execution.finished;
    execution.ending = true;
    execution.granted.reject(new Error('Interaction execution has ended'));
    const state = execution.resource && this.resources[execution.resource];
    if (state)
      state.waiting = state.waiting.filter((entry) => entry !== execution);
    for (const [signal, listener] of execution.listeners)
      signal.removeEventListener('abort', listener);
    execution.finished = execution.pending.then(() => {
      if (state?.owner === execution) {
        state.owner = undefined;
        this.events.next({
          event: 'released',
          resource: execution.resource!,
          taskId: execution.taskId,
          workerId: execution.workerId,
          executionId,
          parentRunId: execution.parentRunId,
          durationMs: Date.now() - (execution.acquiredAt ?? Date.now()),
        });
        this.advance(state);
      }
      this.executions.delete(executionId);
      this.publish();
    });
    this.publish();
    return execution.finished;
  }

  async finishParent(parentRunId: string) {
    await Promise.all(
      [...this.executions.values()]
        .filter((entry) => entry.parentRunId === parentRunId)
        .map((entry) => this.finish(entry.executionId)),
    );
  }

  /** A client timeout does not establish that a device stopped mutating. */
  unavailable(resource: InteractionResource) {
    const state = this.resources[resource];
    if (state.unavailable) return;
    state.unavailable = true;
    this.events.next({ event: 'unavailable', resource });
    for (const entry of state.waiting) void this.finish(entry.executionId);
    this.publish();
  }

  private advance(state: Resource) {
    if (state.owner || state.unavailable || this.closing) return;
    const next = state.waiting.shift();
    if (next) {
      state.owner = next;
      next.acquiredAt = Date.now();
      this.events.next({
        event: 'acquired',
        resource: next.resource!,
        taskId: next.taskId,
        workerId: next.workerId,
        executionId: next.executionId,
        parentRunId: next.parentRunId,
        durationMs: next.acquiredAt - (next.queuedAt ?? next.acquiredAt),
      });
      next.granted.resolve();
    }
  }

  async shutdown() {
    this.closing = true;
    await Promise.all([...this.executions.keys()].map((id) => this.finish(id)));
    this.changes.complete();
    this.events.complete();
  }

  onModuleDestroy() {
    return this.shutdown();
  }
}

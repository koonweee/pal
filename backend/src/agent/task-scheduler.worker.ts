import { SchedulerWorker } from '@mastra/core/worker';

// Mastra 1.74 starts polling before attaching its in-process agent consumer.
// Start that native consumer first so overdue ticks at boot are delivered.
export class TaskSchedulerWorker extends SchedulerWorker {
  override async start() {
    const consumer = this.mastra?.getWorker('agent-schedule');
    if (!consumer || !this.deps)
      throw new Error('Native agent schedule consumer is unavailable');
    if (!consumer.isRunning) {
      await consumer.init(this.deps);
      await consumer.start();
    }
    await super.start();
  }
}

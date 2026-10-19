import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';

@Injectable()
export class AgentAdmissionService {
  private entrants = 0;
  private scheduled = new Set<string>();
  private barrier?: Promise<void>;
  private nativeBusy: () => boolean = () => false;

  bind(isBusy: () => boolean) {
    this.nativeBusy = isBusy;
  }

  async dispatch<T>(work: () => Promise<T>): Promise<T> {
    while (this.barrier) await this.barrier;
    this.entrants++;
    try {
      return await work();
    } finally {
      this.entrants--;
    }
  }

  async prepareSchedule(id: string) {
    while (this.barrier) await this.barrier;
    this.scheduled.add(id);
  }
  finishSchedule(id: string) {
    this.scheduled.delete(id);
  }

  async apply<T>(work: () => Promise<T>): Promise<T> {
    if (
      this.barrier ||
      this.entrants ||
      this.scheduled.size ||
      this.nativeBusy()
    )
      throw new ApplicationError(
        'conflict',
        'Apply requires all agents to be idle. Try again when they finish.',
      );
    let release!: () => void;
    this.barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      return await work();
    } finally {
      this.barrier = undefined;
      release();
    }
  }
}

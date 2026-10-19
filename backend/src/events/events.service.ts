import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { PalEvent } from './events.types.js';
@Injectable()
export class EventsService {
  private readonly subject = new Subject<PalEvent>();
  readonly changes = this.subject.asObservable();
  publish(event: PalEvent) {
    this.subject.next(event);
  }
}

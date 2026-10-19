import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import type { Executor } from '../database/database.service.js';
import { DestinationRepository } from './destination.repository.js';
import { validDestinationIds } from './destination-codec.js';
import type { DestinationRole } from './destination.types.js';

@Injectable()
export class DestinationService {
  constructor(
    @Inject(DestinationRepository)
    private readonly repository: DestinationRepository,
  ) {}

  async requireIngress(
    id: string,
    expected: { adapterId: string; role: DestinationRole },
  ) {
    const destination = await this.repository.get(id);
    if (
      !destination ||
      !destination.enabled ||
      destination.adapterId !== expected.adapterId ||
      destination.role !== expected.role
    )
      throw new ApplicationError('invalid_input', 'Invalid input destination');
    return destination;
  }

  async list() {
    return (await this.repository.list()).filter(
      (destination) => destination.enabled,
    );
  }

  async resolve(ids: string[], notify: boolean, db?: Executor) {
    const destinations = await this.repository.list(db);
    if (
      !validDestinationIds(ids) ||
      ids.some(
        (id) =>
          !destinations.some(
            (d) => d.id === id && d.enabled && d.role === 'secondary',
          ),
      )
    )
      throw new ApplicationError(
        'invalid_input',
        'Unknown or disabled additional destination',
      );
    const selected = destinations.filter(
      (d) => d.enabled && (d.role === 'canonical' || ids.includes(d.id)),
    );
    const includedIds = selected.map((d) => d.id);
    return {
      deliveryDestinationIds: includedIds,
      notificationDestinationIds: notify ? includedIds : [],
      secondaryDestinationIds: selected
        .filter((d) => d.role === 'secondary')
        .map((d) => d.id),
    };
  }
}

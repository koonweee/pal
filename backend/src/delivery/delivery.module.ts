import { Module } from '@nestjs/common';
import { DestinationRepository } from './destination.repository.js';
import { DestinationService } from './destination.service.js';
import { DeliveryJobRepository } from './delivery-job.repository.js';

@Module({
  providers: [DestinationRepository, DestinationService, DeliveryJobRepository],
  exports: [DestinationRepository, DestinationService, DeliveryJobRepository],
})
/** Registers destination policy and durable delivery persistence for adapters. */
export class DeliveryModule {}

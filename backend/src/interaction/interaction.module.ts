import { Module } from '@nestjs/common';
import { InteractionCoordinator } from './interaction-coordinator.js';

@Module({
  providers: [InteractionCoordinator],
  exports: [InteractionCoordinator],
})
export class InteractionModule {}

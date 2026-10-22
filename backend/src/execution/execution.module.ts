import { Global, Module } from '@nestjs/common';
import { ExecutionService } from './execution.service.js';

@Global()
@Module({
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}

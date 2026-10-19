import { Global, Module } from '@nestjs/common';
import { McpService } from './mcp.service.js';
import { McpRepository } from './mcp.repository.js';
import { AgentAdmissionService } from './agent-admission.service.js';
@Global()
@Module({
  providers: [McpRepository, McpService, AgentAdmissionService],
  exports: [McpService, AgentAdmissionService],
})
export class McpModule {}

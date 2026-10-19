import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { McpService } from '../../mcp/mcp.service.js';
import { SaveMcpServerDto } from './mcp.dto.js';
import {
  ApplicationErrorResponseDto,
  AuthorizationUrlResponseDto,
  IdResponseDto,
  McpSnapshotResponseDto,
} from './public.dto.js';

@ApiTags('connected-services')
@ApiDefaultResponse({ type: ApplicationErrorResponseDto })
@Controller('mcp')
export class FirstPartyMcpController {
  constructor(@Inject(McpService) private readonly mcp: McpService) {}
  @Get('servers')
  @ApiOperation({ operationId: 'getMcpServers' })
  @ApiOkResponse({ type: McpSnapshotResponseDto })
  list() {
    return this.mcp.list();
  }
  @Post('servers')
  @ApiOperation({ operationId: 'createMcpServer' })
  @ApiCreatedResponse({ type: IdResponseDto })
  create(@Body() body: SaveMcpServerDto) {
    return this.mcp.save(body);
  }
  @Patch('servers/:id')
  @ApiOperation({ operationId: 'updateMcpServer' })
  @ApiOkResponse({ type: IdResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveMcpServerDto,
  ) {
    return this.mcp.save(body, id);
  }
  @Delete('servers/:id')
  @ApiOperation({ operationId: 'removeMcpServer' })
  @ApiOkResponse({ description: 'Server removed.' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.mcp.remove(id);
  }
  @Post('apply')
  @ApiOperation({ operationId: 'applyMcpServers' })
  @ApiCreatedResponse({ type: McpSnapshotResponseDto })
  apply() {
    return this.mcp.apply();
  }
  @Post('servers/:id/login')
  @ApiOperation({ operationId: 'startMcpLogin' })
  @ApiCreatedResponse({ type: AuthorizationUrlResponseDto })
  login(@Param('id', ParseUUIDPipe) id: string) {
    return this.mcp.login(id);
  }
  @Delete('servers/:id/login')
  @ApiOperation({ operationId: 'forgetMcpLogin' })
  @ApiOkResponse({ description: 'Saved login removed.' })
  forget(@Param('id', ParseUUIDPipe) id: string) {
    return this.mcp.forget(id);
  }
  @Get('oauth/callback')
  @ApiOperation({ operationId: 'completeMcpOauth' })
  @ApiProduces('text/plain')
  @ApiOkResponse({ schema: { type: 'string' } })
  async callback(
    @Query()
    query: { state?: string; code?: string; error?: string; iss?: string },
    @Res() response: Response,
  ) {
    await this.mcp.callback(query);
    response
      .type('text/plain')
      .send(
        'Connected. Return to Pal settings and Apply when agents are idle.',
      );
  }
}

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import {
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { TasksService } from '../../tasks/tasks.service.js';
import { TasksQuery } from './pagination.dto.js';
import {
  ApplicationErrorResponseDto,
  TaskDetailsEnvelopeResponseDto,
  TaskPageResponseDto,
} from './public.dto.js';

class ArchiveTaskDto {
  @ApiProperty()
  @IsBoolean()
  archived!: boolean;
}

@ApiTags('tasks')
@ApiDefaultResponse({ type: ApplicationErrorResponseDto })
@Controller('tasks')
export class FirstPartyTasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ operationId: 'getTasks' })
  @ApiOkResponse({ type: TaskPageResponseDto })
  list(@Query() query: TasksQuery) {
    return this.tasks.list(query);
  }

  @Get('details/:id')
  @ApiOperation({ operationId: 'getTaskDetails' })
  @ApiOkResponse({ type: TaskDetailsEnvelopeResponseDto })
  async details(@Param('id', ParseUUIDPipe) id: string) {
    return { task: await this.tasks.details(id) };
  }

  @Post(':id/archive')
  @ApiOperation({ operationId: 'setTaskArchived' })
  @ApiCreatedResponse({ description: 'Archive state updated.' })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ArchiveTaskDto,
  ) {
    await this.tasks.update(id, { archived: body.archived });
  }
}

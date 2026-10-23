import { LoginUpdatedEventDto } from './login.controller.js';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Observable, interval } from 'rxjs';
import { EventsService } from '../../events/events.service.js';
import { AgentActivityService } from '../../agent/agent-activity.service.js';
import {
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  AgentActivityEventResponseDto,
  FrontendUpdatedEventResponseDto,
  HeartbeatEventResponseDto,
  MessageEventResponseDto,
  TaskEventResponseDto,
} from './public.dto.js';
import { InstanceSettingsUpdatedEventResponseDto } from './instance-settings.controller.js';
import { FIRST_PARTY_CONTRACT_VERSION } from './first-party-contract.js';

export class FrontendUpdateRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  revision!: string;
}

/** Live hints for first-party clients; snapshots remain authoritative after gaps. */
@ApiTags('events')
@ApiExtraModels(
  MessageEventResponseDto,
  TaskEventResponseDto,
  AgentActivityEventResponseDto,
  FrontendUpdatedEventResponseDto,
  HeartbeatEventResponseDto,
  InstanceSettingsUpdatedEventResponseDto,
  LoginUpdatedEventDto,
)
@Controller()
export class FirstPartyStreamController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AgentActivityService)
    private readonly activity: AgentActivityService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Post('frontend-updates')
  @HttpCode(204)
  @ApiOperation({ operationId: 'publishFrontendUpdate' })
  @ApiNoContentResponse({ description: 'Frontend update marker published.' })
  publishFrontendUpdate(@Body() input: FrontendUpdateRequestDto) {
    this.events.publish({
      event: 'frontend.updated',
      releaseId: input.revision,
      contractVersion: FIRST_PARTY_CONTRACT_VERSION,
    });
  }

  @Sse('stream')
  @ApiOperation({ operationId: 'streamEvents' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'Named SSE events carrying one Pal event envelope.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(LoginUpdatedEventDto) },
        { $ref: getSchemaPath(MessageEventResponseDto) },
        { $ref: getSchemaPath(TaskEventResponseDto) },
        { $ref: getSchemaPath(AgentActivityEventResponseDto) },
        { $ref: getSchemaPath(FrontendUpdatedEventResponseDto) },
        { $ref: getSchemaPath(HeartbeatEventResponseDto) },
        { $ref: getSchemaPath(InstanceSettingsUpdatedEventResponseDto) },
      ],
    },
  })
  stream(): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const changes = this.events.changes.subscribe((event) =>
        subscriber.next({ type: event.event, data: event }),
      );
      subscriber.next({
        type: 'agent.activity',
        data: { event: 'agent.activity', state: this.activity.current() },
      });
      subscriber.next({
        type: 'frontend.updated',
        data: {
          event: 'frontend.updated',
          releaseId: this.config.getOrThrow<string>('PAL_RELEASE_ID'),
          contractVersion: FIRST_PARTY_CONTRACT_VERSION,
        },
      });
      const heartbeat = interval(15000).subscribe(() =>
        subscriber.next({ type: 'heartbeat', data: { event: 'heartbeat' } }),
      );
      return () => {
        changes.unsubscribe();
        heartbeat.unsubscribe();
      };
    });
  }
}

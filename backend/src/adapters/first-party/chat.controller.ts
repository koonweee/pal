import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatService } from '../../chat/chat.service.js';
import { ChatCoordinatorService } from '../../application/chat-coordinator.service.js';
import { DestinationService } from '../../delivery/destination.service.js';
import { HistoryQuery, SelectActionDto, SendMessageDto } from './chat.dto.js';
import {
  ApplicationErrorResponseDto,
  HistoryPageResponseDto,
  MessageAcceptedResponseDto,
} from './public.dto.js';

/** HTTP projection of Pal's transport-neutral chat application contract. */
@ApiTags('chat')
@ApiDefaultResponse({ type: ApplicationErrorResponseDto })
@Controller('chat')
export class FirstPartyChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(ChatCoordinatorService)
    private readonly coordinator: ChatCoordinatorService,
    @Inject(DestinationService)
    private readonly destinations: DestinationService,
  ) {}

  @Get('history')
  @ApiOperation({ operationId: 'getChatHistory' })
  @ApiOkResponse({ type: HistoryPageResponseDto })
  history(@Query() query: HistoryQuery) {
    return this.chat.history(query);
  }

  @Post('messages')
  @ApiOperation({ operationId: 'sendChatMessage' })
  @ApiCreatedResponse({ type: MessageAcceptedResponseDto })
  async send(@Body() input: SendMessageDto) {
    const destinationId = input.destinationId ?? 'web';
    const destination = await this.destinations.requireIngress(destinationId, {
      adapterId: 'first-party',
      role: 'canonical',
    });
    const { destinationId: _destinationId, ...message } = input;
    return this.coordinator.send({
      ...message,
      source: destination.id,
      originDestinationId: destination.id,
    });
  }

  @Post('actions')
  @HttpCode(200)
  @ApiOperation({ operationId: 'selectMessageAction' })
  @ApiOkResponse({ type: MessageAcceptedResponseDto })
  select(@Body() input: SelectActionDto) {
    return this.chat.selectAction(input);
  }
}

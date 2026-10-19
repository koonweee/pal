import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { PreferencesService } from '../../preferences/preferences.service.js';
import {
  CreatePreferenceDto,
  PreferenceHistoryQuery,
  PreferenceListQuery,
  UpdatePreferenceDto,
} from './preferences.dto.js';
import {
  ApplicationErrorResponseDto,
  PreferencePageResponseDto,
  PreferenceResponseDto,
  PreferenceRevisionPageResponseDto,
} from './public.dto.js';

@ApiTags('preferences')
@ApiDefaultResponse({ type: ApplicationErrorResponseDto })
@Controller('preferences')
export class FirstPartyPreferencesController {
  constructor(
    @Inject(PreferencesService)
    private readonly preferences: PreferencesService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'getPreferences' })
  @ApiOkResponse({ type: PreferencePageResponseDto })
  list(@Query() query: PreferenceListQuery) {
    return this.preferences.search(query);
  }

  @Post()
  @ApiOperation({ operationId: 'createPreference' })
  @ApiCreatedResponse({ type: PreferenceResponseDto })
  create(@Body() input: CreatePreferenceDto) {
    return this.preferences.create(
      {
        topic: input.topic,
        statement: input.statement,
        appliesWhen: input.appliesWhen,
        sourceMessageIds: input.sourceMessageIds,
        reason: input.reason,
        basis: 'user-stated',
      },
      { actor: 'human' },
    );
  }

  @Get(':id/history')
  @ApiOperation({ operationId: 'getPreferenceHistory' })
  @ApiOkResponse({ type: PreferenceRevisionPageResponseDto })
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PreferenceHistoryQuery,
  ) {
    return this.preferences.history(id, query);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getPreference' })
  @ApiOkResponse({ type: PreferenceResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.preferences.get(id);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updatePreference' })
  @ApiOkResponse({ type: PreferenceResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdatePreferenceDto,
  ) {
    return this.preferences.update(id, input, { actor: 'human' });
  }
}

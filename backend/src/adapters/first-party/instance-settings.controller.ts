import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { ApplicationErrorResponseDto } from './public.dto.js';
import { InstanceSettingsService } from '../../instance-settings/instance-settings.service.js';

export class InstanceSettingsResponseDto {
  @ApiProperty({ maxLength: 60 }) agentName!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  agentAvatarAttachmentId!: string | null;
  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' }) accentColor!: string;
  @ApiProperty({ minimum: 0 }) version!: number;
}
export class UpdateInstanceSettingsDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 60)
  agentName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsUUID()
  agentAvatarAttachmentId?: string | null;

  @ApiPropertyOptional({ pattern: '^#[0-9a-fA-F]{6}$' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^#[0-9a-f]{6}$/i)
  accentColor?: string;
}
export class InstanceSettingsUpdatedEventResponseDto {
  @ApiProperty({ enum: ['instance.settings.updated'] })
  event!: 'instance.settings.updated';
}

@ApiTags('instance settings')
@ApiDefaultResponse({ type: ApplicationErrorResponseDto })
@Controller('instance-settings')
export class FirstPartyInstanceSettingsController {
  constructor(
    @Inject(InstanceSettingsService)
    private readonly settings: InstanceSettingsService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'getInstanceSettings' })
  @ApiOkResponse({ type: InstanceSettingsResponseDto })
  get() {
    return this.settings.get();
  }

  @Patch()
  @ApiOperation({ operationId: 'updateInstanceSettings' })
  @ApiOkResponse({ type: InstanceSettingsResponseDto })
  update(@Body() input: UpdateInstanceSettingsDto) {
    return this.settings.update(input);
  }
}

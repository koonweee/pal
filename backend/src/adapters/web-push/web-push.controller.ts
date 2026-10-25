import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApplicationErrorResponseDto } from '../first-party/public.dto.js';
import { WebPushService } from './web-push.service.js';

class WebPushKeysDto {
  @ApiProperty() @IsString() @Length(86, 88) p256dh!: string;
  @ApiProperty() @IsString() @Length(22, 24) auth!: string;
}
class RegisterWebPushDto {
  @ApiProperty({ maxLength: 4096 })
  @IsString()
  @Length(1, 4096)
  endpoint!: string;
  @ApiProperty({ type: WebPushKeysDto })
  @ValidateNested()
  @Type(() => WebPushKeysDto)
  keys!: WebPushKeysDto;
}
class WebPushConfigDto {
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: String, nullable: true }) publicKey!: string | null;
}
class WebPushSeenDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) generation!: number;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  through!: number;
}
class WebPushBadgeDto {
  @ApiProperty({ format: 'uuid' }) installationId!: string;
  @ApiProperty() generation!: number;
  @ApiProperty() count!: number;
  @ApiProperty() through!: number;
  @ApiProperty() revision!: number;
}
class WebPushRegistrationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}

@ApiTags('notifications')
@ApiDefaultResponse({ type: ApplicationErrorResponseDto })
@Controller('notifications/web')
export class WebPushController {
  constructor(
    @Inject(WebPushService) private readonly notifications: WebPushService,
  ) {}

  @Get('config')
  @ApiOperation({ operationId: 'getWebPushConfig' })
  @ApiOkResponse({ type: WebPushConfigDto })
  configuration() {
    return this.notifications.configuration();
  }

  @Post('installations')
  @ApiOperation({ operationId: 'registerWebPush' })
  @ApiCreatedResponse({ type: WebPushRegistrationDto })
  register(@Body() input: RegisterWebPushDto) {
    return this.notifications.register(input);
  }

  @Get('installations/:id/badge')
  @ApiOperation({ operationId: 'getWebPushBadge' })
  @ApiOkResponse({ type: WebPushBadgeDto })
  badge(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.notifications.badge(id);
  }

  @Put('installations/:id/badge')
  @ApiOperation({ operationId: 'acknowledgeWebPushBadge' })
  @ApiOkResponse({ type: WebPushBadgeDto })
  acknowledge(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() seen: WebPushSeenDto,
  ) {
    return this.notifications.badge(id, seen);
  }

  @Delete('installations/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'disableWebPush' })
  @ApiNoContentResponse()
  disable(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.notifications.disable(id);
  }
}

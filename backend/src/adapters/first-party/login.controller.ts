import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiProduces,
} from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import type { Response } from 'express';
import { LoginService } from '../../login/login.service.js';

class LoginAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
}
class PaymentCardDto extends LoginAccountDto {
  @ApiProperty() brand!: string;
  @ApiProperty() lastFour!: string;
}
class SubmitCardDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() save?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string;
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  cardholderName?: string;
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @Length(12, 25)
  number?: string;
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @Length(1, 2)
  expMonth?: string;
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @Length(2, 4)
  expYear?: string;
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @Length(3, 4)
  securityCode?: string;
}
class LoginRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ enum: ['credentials', 'code', 'card'] }) kind!:
    'credentials' | 'code' | 'card';
  @ApiProperty({
    enum: [
      'pending',
      'saved',
      'selected',
      'filled',
      'cancelled',
      'updating',
      'failed',
    ],
  })
  status!: string;
  @ApiProperty({ nullable: true, type: String }) inspectionId!: string | null;
  @ApiProperty() configured!: boolean;
  @ApiProperty() keepMeSignedIn!: boolean;
  @ApiPropertyOptional({ type: [String] }) fields?: string[];
  @ApiPropertyOptional({ type: [PaymentCardDto] }) cards?: PaymentCardDto[];
  @ApiProperty() chooseAccount!: boolean;
  @ApiProperty({ type: [LoginAccountDto] }) accounts!: LoginAccountDto[];
}
export class LoginUpdatedEventDto {
  @ApiProperty({ enum: ['login.updated'] }) event!: 'login.updated';
  @ApiProperty() taskId!: string;
}
class SaveLoginDto {
  @ApiProperty({ minLength: 1, maxLength: 1024 })
  @IsString()
  @Length(1, 1024)
  username!: string;
  @ApiProperty({ minLength: 1, maxLength: 4096, writeOnly: true })
  @IsString()
  @Length(1, 4096)
  password!: string;
  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @Length(1, 80)
  label!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() keepMeSignedIn?: boolean;
}
class SelectLoginAccountDto {
  @ApiProperty() @IsUUID() accountId!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() keepMeSignedIn?: boolean;
}
class SubmitCodeDto {
  @ApiProperty({ minLength: 1, maxLength: 64, writeOnly: true })
  @IsString()
  @Length(1, 64)
  code!: string;
}
class LoginFinishedDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    enum: ['saved', 'selected', 'filled', 'cancelled', 'updating', 'failed'],
  })
  status!: string;
}

@ApiTags('login')
@Controller('login')
export class FirstPartyLoginController {
  constructor(@Inject(LoginService) private readonly login: LoginService) {}
  @Get('requests/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getLoginRequest' })
  @ApiOkResponse({ type: LoginRequestDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.login.get(id);
  }
  @Get('inspections/:id/image')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getLoginInspectionImage' })
  @ApiProduces('image/png')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    response.type('image/png').send(await this.login.preview(id));
  }
  @Post('requests/:id/save')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'saveLoginRequest' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  save(@Param('id', ParseUUIDPipe) id: string, @Body() input: SaveLoginDto) {
    return this.login.finish(id, input);
  }
  @Post('requests/:id/select')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'selectLoginAccount' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  select(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: SelectLoginAccountDto,
  ) {
    return this.login.selectAccount(id, input.accountId, input.keepMeSignedIn);
  }
  @Post('requests/:id/code')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'submitLoginCode' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  code(@Param('id', ParseUUIDPipe) id: string, @Body() input: SubmitCodeDto) {
    return this.login.submitCode(id, input.code);
  }
  @Post('requests/:id/card')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'submitPaymentCard' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  card(@Param('id', ParseUUIDPipe) id: string, @Body() input: SubmitCardDto) {
    return this.login.submitCard(id, input);
  }
  @Post('requests/:id/retry')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'retryLoginRequest' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.login.retry(id);
  }
  @Post('requests/:id/cancel')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'cancelLoginRequest' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.login.finish(id);
  }
}

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
import { IsOptional, IsString, Length, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { LoginService } from '../../login/login.service.js';

class LoginAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
}
class LoginRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ enum: ['credentials', 'code'] }) kind!: 'credentials' | 'code';
  @ApiProperty({
    enum: ['pending', 'saved', 'filled', 'cancelled', 'updating', 'failed'],
  })
  status!: string;
  @ApiProperty({ nullable: true, type: String }) inspectionId!: string | null;
  @ApiProperty() configured!: boolean;
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
}
class SubmitCodeDto {
  @ApiProperty({ minLength: 1, maxLength: 64, writeOnly: true })
  @IsString()
  @Length(1, 64)
  code!: string;
}
class LoginFinishedDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['saved', 'filled', 'cancelled', 'updating', 'failed'] })
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
  @Post('requests/:id/code')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'submitLoginCode' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  code(@Param('id', ParseUUIDPipe) id: string, @Body() input: SubmitCodeDto) {
    return this.login.submitCode(id, input.code);
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

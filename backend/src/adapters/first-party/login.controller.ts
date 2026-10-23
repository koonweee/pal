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

class LoginTargetDto {
  @ApiProperty() loginRef!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ type: [String] }) fields!: string[];
}
class LoginAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
}
class LoginRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ enum: ['pending', 'saved', 'cancelled'] }) status!:
    'pending' | 'saved' | 'cancelled';
  @ApiProperty({ type: [LoginAccountDto] }) accounts!: LoginAccountDto[];
}
class LoginInspectionDto {
  @ApiProperty() id!: string;
  @ApiProperty() origin!: string;
  @ApiProperty({ type: [LoginTargetDto] }) targets!: LoginTargetDto[];
}
class LoginSnapshotDto {
  @ApiProperty() configured!: boolean;
  @ApiProperty({ type: [LoginRequestDto] }) requests!: LoginRequestDto[];
  @ApiProperty({ type: [LoginInspectionDto] })
  inspections!: LoginInspectionDto[];
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
class LoginFinishedDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['saved', 'cancelled'] }) status!: string;
}

@ApiTags('login')
@Controller('login')
export class FirstPartyLoginController {
  constructor(@Inject(LoginService) private readonly login: LoginService) {}
  @Get('tasks/:taskId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getLoginSnapshot' })
  @ApiOkResponse({ type: LoginSnapshotDto })
  snapshot(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.login.snapshot(taskId);
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
  @Post('requests/:id/cancel')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'cancelLoginRequest' })
  @ApiCreatedResponse({ type: LoginFinishedDto })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.login.finish(id);
  }
}

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { IsIn, IsString, Matches } from 'class-validator';
import { NativeInstallationRepository } from './native-installation.repository.js';

class RegisterIosInstallationDto {
  @IsString()
  @Matches(/^(?:[a-fA-F0-9]{2}){16,256}$/)
  token!: string;

  @IsIn(['development', 'production'])
  environment!: 'development' | 'production';
}

@Controller('notifications/ios/installations')
export class NativeNotificationsController {
  constructor(
    @Inject(NativeInstallationRepository)
    private readonly installations: NativeInstallationRepository,
  ) {}

  @Put(':id')
  async register(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: RegisterIosInstallationDto,
  ) {
    const installation = await this.installations.register({
      id,
      token: input.token,
      environment: input.environment,
    });
    return {
      id: installation.id,
      enabled: installation.enabled,
      environment: installation.environment,
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.installations.disable(id);
  }
}

import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { InstanceSettingsRepository } from './instance-settings.repository.js';
import { InstanceSettingsService } from './instance-settings.service.js';

@Module({
  imports: [FilesModule],
  providers: [InstanceSettingsRepository, InstanceSettingsService],
  exports: [InstanceSettingsService],
})
export class InstanceSettingsModule {}

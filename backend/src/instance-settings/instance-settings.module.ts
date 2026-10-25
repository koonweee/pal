import { Module } from '@nestjs/common';
import { PwaManifestService } from './pwa-manifest.service.js';
import { FilesModule } from '../files/files.module.js';
import { InstanceSettingsRepository } from './instance-settings.repository.js';
import { InstanceSettingsService } from './instance-settings.service.js';

@Module({
  imports: [FilesModule],
  providers: [
    InstanceSettingsRepository,
    InstanceSettingsService,
    PwaManifestService,
  ],
  exports: [InstanceSettingsService, PwaManifestService],
})
export class InstanceSettingsModule {}

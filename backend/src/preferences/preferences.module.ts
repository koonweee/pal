import { Module } from '@nestjs/common';
import { PreferencesRepository } from './preferences.repository.js';
import { PreferencesService } from './preferences.service.js';

@Module({
  providers: [PreferencesRepository, PreferencesService],
  exports: [PreferencesService],
})
export class PreferencesModule {}

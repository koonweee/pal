import { Module } from '@nestjs/common';
import { FilesRepository } from './files.repository.js';
import { FilesService } from './files.service.js';
import { ApplicationFileStorage } from './application-file-storage.js';
@Module({
  providers: [FilesRepository, FilesService, ApplicationFileStorage],
  exports: [FilesRepository, FilesService],
})
export class FilesModule {}

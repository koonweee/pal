import { AndroidViewerService } from './android-viewer.service.js';
import { Module } from '@nestjs/common';
import { AndroidService } from './android.service.js';
@Module({
  providers: [AndroidService, AndroidViewerService],
  exports: [AndroidService],
})
export class AndroidModule {}

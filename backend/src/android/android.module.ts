import { AndroidViewerService } from './android-viewer.service.js';
import { Module } from '@nestjs/common';
import { AndroidService } from './android.service.js';
import { InteractionModule } from '../interaction/interaction.module.js';
@Module({
  imports: [InteractionModule],
  providers: [AndroidService, AndroidViewerService],
  exports: [AndroidService],
})
export class AndroidModule {}

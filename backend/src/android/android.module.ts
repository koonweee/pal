import { Module } from '@nestjs/common';
import { AndroidService } from './android.service.js';
@Module({ providers: [AndroidService], exports: [AndroidService] })
export class AndroidModule {}

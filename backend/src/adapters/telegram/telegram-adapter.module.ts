import { Module } from '@nestjs/common';
import { SecondaryAdapterModule } from '../secondary/secondary-adapter.module.js';
import { TelegramDriver } from './telegram.driver.js';

/** Registers the optional single-owner Telegram DM binding. */
@Module({
  imports: [SecondaryAdapterModule],
  providers: [TelegramDriver],
})
export class TelegramAdapterModule {}

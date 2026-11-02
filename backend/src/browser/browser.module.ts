import { Module } from '@nestjs/common';
import { SharedBrowserService } from './shared-browser.service.js';
@Module({
  providers: [SharedBrowserService],
  exports: [SharedBrowserService],
})
export class BrowserModule {}

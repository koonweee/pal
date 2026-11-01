import { AndroidModule } from '../android/android.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module.js';
import { BitwardenService } from './bitwarden.service.js';
import { LoginRepository } from './login.repository.js';
import { LoginService } from './login.service.js';
@Module({
  imports: [BrowserModule, TasksModule, ChatModule, AndroidModule],
  providers: [BitwardenService, LoginRepository, LoginService],
  exports: [LoginService],
})
export class LoginModule {}

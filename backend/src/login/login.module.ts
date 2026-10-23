import { TasksModule } from '../tasks/tasks.module.js';
import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module.js';
import { BitwardenService } from './bitwarden.service.js';
import { LoginRepository } from './login.repository.js';
import { LoginService } from './login.service.js';
@Module({
  imports: [BrowserModule, TasksModule],
  providers: [BitwardenService, LoginRepository, LoginService],
  exports: [LoginService],
})
export class LoginModule {}

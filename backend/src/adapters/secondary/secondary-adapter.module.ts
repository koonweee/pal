import { Module } from '@nestjs/common';
import { ApplicationModule } from '../../application/application.module.js';
import { ChatModule } from '../../chat/chat.module.js';
import { DeliveryModule } from '../../delivery/delivery.module.js';
import { FilesModule } from '../../files/files.module.js';
import { DeliveryDispatcherService } from './delivery-dispatcher.service.js';
import { SecondaryIngressService } from './secondary-ingress.service.js';
import { SecondaryRepository } from './secondary.repository.js';
import { SecondaryDriverHostService } from './secondary-driver-host.service.js';

/**
 * Registers shared secondary ingress and delivery. Provider modules contribute
 * drivers through `SecondaryDriverHostService`; this module owns no provider API.
 */
@Module({
  imports: [ApplicationModule, ChatModule, DeliveryModule, FilesModule],
  providers: [
    SecondaryDriverHostService,
    SecondaryRepository,
    SecondaryIngressService,
    DeliveryDispatcherService,
  ],
  exports: [SecondaryDriverHostService],
})
export class SecondaryAdapterModule {}

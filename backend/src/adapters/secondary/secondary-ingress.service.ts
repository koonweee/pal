import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../application/contracts/errors.js';
import { ChatCoordinatorService } from '../../application/chat-coordinator.service.js';
import { DestinationService } from '../../delivery/destination.service.js';
import { FilesService } from '../../files/files.service.js';
import type { SecondaryDriver, SecondaryInput } from './secondary-driver.js';
import { SecondaryRepository } from './secondary.repository.js';

/**
 * Shared Main-only ingress for secondary providers. It owns destination
 * validation, provider-scoped deduplication, file import, and quote lookup.
 */
@Injectable()
export class SecondaryIngressService {
  constructor(
    @Inject(ChatCoordinatorService)
    private readonly coordinator: ChatCoordinatorService,
    @Inject(DestinationService)
    private readonly destinations: DestinationService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(SecondaryRepository)
    private readonly repository: SecondaryRepository,
  ) {}

  async accept(driver: SecondaryDriver, input: SecondaryInput) {
    await this.destinations.requireIngress(driver.destinationId, {
      adapterId: driver.adapterId,
      role: 'secondary',
    });
    const existing = await this.repository.input(
      driver.adapterId,
      driver.destinationId,
      input.externalEventId,
    );
    if (existing) return { messageId: existing.canonicalMessageId };
    if (!input.text.trim() && !input.attachments.length)
      throw new ApplicationError('invalid_input', 'Secondary input is empty');

    const attachments = [];
    for (const attachment of input.attachments)
      attachments.push(await this.files.upload(attachment));
    const quoted = input.replyToExternalMessageId
      ? await this.repository.byExternal(
          driver.adapterId,
          driver.destinationId,
          input.replyToExternalMessageId,
        )
      : undefined;
    const identity = [
      driver.adapterId,
      driver.destinationId,
      input.externalEventId,
    ].join('\0');
    const { messageId } = await this.coordinator.send({
      idempotencyKey:
        'secondary:' + createHash('sha256').update(identity).digest('hex'),
      source: driver.adapterId,
      originDestinationId: driver.destinationId,
      text: input.text,
      attachmentIds: attachments.map((attachment) => attachment.id),
      ...(quoted ? { replyToMessageId: quoted.canonicalMessageId } : {}),
    });
    await this.repository.recordInput({
      adapterId: driver.adapterId,
      destinationId: driver.destinationId,
      externalEventId: input.externalEventId,
      externalMessageId: input.externalMessageId,
      externalThreadId: input.externalThreadId,
      canonicalMessageId: messageId,
    });
    return { messageId };
  }
}

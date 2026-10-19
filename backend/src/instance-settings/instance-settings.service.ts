import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ApplicationError } from '../application/contracts/errors.js';
import { EventsService } from '../events/events.service.js';
import { FilesService } from '../files/files.service.js';
import { InstanceSettingsRepository } from './instance-settings.repository.js';
import type { UpdateInstanceSettings } from './instance-settings.types.js';

@Injectable()
export class InstanceSettingsService {
  constructor(
    @Inject(InstanceSettingsRepository)
    private readonly repository: InstanceSettingsRepository,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  get() {
    return this.repository.get();
  }

  async update(input: UpdateInstanceSettings) {
    const patch: UpdateInstanceSettings = {};
    if (input.agentName !== undefined) {
      if (
        typeof input.agentName !== 'string' ||
        !input.agentName.trim() ||
        input.agentName.trim().length > 60
      )
        throw new ApplicationError(
          'invalid_input',
          'Agent name must be 1 to 60 characters',
        );
      patch.agentName = input.agentName.trim();
    }
    if (input.accentColor !== undefined) {
      if (
        typeof input.accentColor !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(input.accentColor)
      )
        throw new ApplicationError(
          'invalid_input',
          'Accent color must be a six-digit hex color',
        );
      patch.accentColor = input.accentColor.toLowerCase();
    }
    if (input.agentAvatarAttachmentId !== undefined) {
      if (input.agentAvatarAttachmentId !== null) {
        if (!isUUID(input.agentAvatarAttachmentId))
          throw new ApplicationError('invalid_input', 'Invalid agent image');
        await this.validateAvatar(input.agentAvatarAttachmentId);
      }
      patch.agentAvatarAttachmentId = input.agentAvatarAttachmentId;
    }
    if (!Object.keys(patch).length) return this.get();
    const settings = await this.repository.update(patch);
    this.events.publish({ event: 'instance.settings.updated' });
    return settings;
  }

  private async validateAvatar(id: string) {
    const { file, handle } = await this.files.content(id);
    try {
      if (file.contentType !== 'image/png')
        throw new ApplicationError(
          'invalid_input',
          'Agent image must be a PNG',
        );
      if (file.sizeBytes > 2_000_000)
        throw new ApplicationError(
          'invalid_input',
          'Agent image must be 2 MB or smaller',
        );
      const header = Buffer.alloc(24);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (
        bytesRead !== 24 ||
        !header
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        header.readUInt32BE(8) !== 13 ||
        header.toString('ascii', 12, 16) !== 'IHDR'
      )
        throw new ApplicationError(
          'invalid_input',
          'Agent image must be a PNG',
        );
      const width = header.readUInt32BE(16),
        height = header.readUInt32BE(20);
      if (!width || !height || width > 2048 || height > 2048)
        throw new ApplicationError(
          'invalid_input',
          'Agent image must be at most 2048 × 2048 pixels',
        );
    } finally {
      await handle.close();
    }
  }
}

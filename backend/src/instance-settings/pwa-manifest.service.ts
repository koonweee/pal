import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesService } from '../files/files.service.js';
import { InstanceSettingsService } from './instance-settings.service.js';

@Injectable()
export class PwaManifestService {
  constructor(
    @Inject(InstanceSettingsService)
    private readonly settings: InstanceSettingsService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private get development() {
    return this.config.get<string>('PAL_APP_VARIANT') === 'dev';
  }

  private async avatar() {
    const { agentAvatarAttachmentId: id } = await this.settings.get();
    if (!id) return undefined;
    try {
      const { handle } = await this.files.content(id);
      try {
        const header = Buffer.alloc(24);
        await handle.read(header, 0, header.length, 0);
        return {
          src: `/api/files/${id}/content`,
          sizes: `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`,
          type: 'image/png',
          purpose: 'any',
        };
      } finally {
        await handle.close();
      }
    } catch {
      // Unavailable uploads use the bundled installation identity.
      return undefined;
    }
  }

  async manifest() {
    const avatar = await this.avatar();
    const name = this.development ? 'Pal Dev' : 'Pal';
    const prefix = this.development ? 'pal' : 'pal-production';
    return {
      name,
      short_name: name,
      description: 'Your personal assistant.',
      id: this.development ? '/pal-dev' : '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
      lang: 'en',
      icons: avatar
        ? [avatar]
        : [192, 512].map((size) => ({
            src: `/icons/${prefix}-${size}.png`,
            sizes: `${size}x${size}`,
            type: 'image/png',
            purpose: 'any',
          })),
    };
  }

  async appleTouchIcon() {
    return (
      (await this.avatar())?.src ??
      (this.development
        ? '/icons/apple-touch-icon.png'
        : '/icons/pal-production-180.png')
    );
  }
}

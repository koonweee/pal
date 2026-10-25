import { Controller, Get, Header, Inject, Redirect } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PwaManifestService } from '../../instance-settings/pwa-manifest.service.js';

@ApiExcludeController()
@Controller()
export class FirstPartyPwaController {
  constructor(
    @Inject(PwaManifestService) private readonly pwa: PwaManifestService,
  ) {}

  @Get('manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json')
  @Header('Cache-Control', 'no-store')
  manifest() {
    return this.pwa.manifest();
  }

  @Get(['apple-touch-icon.png', 'apple-touch-icon-precomposed.png'])
  @Header('Cache-Control', 'no-store')
  @Redirect()
  async appleTouchIcon() {
    return { url: await this.pwa.appleTouchIcon() };
  }
}

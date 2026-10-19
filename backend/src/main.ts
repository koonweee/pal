import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApp } from './config/configure-app.js';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    forceCloseConnections: true,
  });
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('HOST'),
  );
}
await bootstrap();

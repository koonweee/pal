import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { writeFile } from 'node:fs/promises';
import { DatabaseModule } from './dist/database/database.module.js';
import { EventsModule } from './dist/events/events.module.js';
import { FilesModule } from './dist/files/files.module.js';
import { FilesService } from './dist/files/files.service.js';
import { ChatModule } from './dist/chat/chat.module.js';
import { ChatService } from './dist/chat/chat.service.js';
import { ExecutionService } from './dist/execution/execution.service.js';
import { validateEnvironment } from './dist/config/configuration.js';

class FileCheckModule {}
Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    EventsModule,
    FilesModule,
    ChatModule,
  ],
})(FileCheckModule);
const app = await NestFactory.createApplicationContext(FileCheckModule, {
  logger: false,
});
const files = app.get(FilesService);
const execution = app.get(ExecutionService);
try {
  const input = new FormData();
  input.append('file', new Blob(['Original split-stack input']), 'input.txt');
  const response = await fetch('http://127.0.0.1:3000/files', {
    method: 'POST',
    body: input,
  });
  assert.equal(response.status, 201);
  const uploaded = await response.json();
  const [manifest] = await files.manifest([uploaded.attachment.id]);
  assert.equal(
    await execution.filesystem.readFile(manifest.path, { encoding: 'utf8' }),
    'Original split-stack input',
  );
  await execution.filesystem.writeFile(
    '/home/pal/workspace/report.txt',
    'Immutable split-stack result',
  );
  const result = await files.importFile({
    path: '/home/pal/workspace/report.txt',
  });
  await app.get(ChatService).publish({
    role: 'assistant',
    text: 'Split runtime verified',
    phase: 'final_answer',
    attachmentIds: [result.id],
  });
  await execution.filesystem.writeFile(
    '/home/pal/workspace/report.txt',
    'Changed after publication',
  );
  const download = await fetch(
    'http://127.0.0.1:3000/files/' + result.id + '/download',
  );
  assert.equal(await download.text(), 'Immutable split-stack result');
  await writeFile('/data/private/split-sentinel', 'private to service');
  await execution.output('ln', [
    '-sf',
    '/data/private/split-sentinel',
    '/home/pal/private-link',
  ]);
  await assert.rejects(
    files.importFile({ path: '/home/pal/private-link' }),
    /not readable/,
  );
  await assert.rejects(execution.filesystem.readFile('/home/pal/private-link'));
  console.log(
    'PASS: HTTP upload, execution inspection, immutable publication/download, and private-path rejection',
  );
} finally {
  await app.close();
  await execution.sandbox._stop();
}

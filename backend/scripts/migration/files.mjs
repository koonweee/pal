import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { ExecutionService } from './dist/execution/execution.service.js';
const execution = new ExecutionService(new ConfigService(process.env));
try {
  assert.equal(
    await execution.filesystem.readFile('/data/home/notes.txt', {
      encoding: 'utf8',
    }),
    'original home',
  );
  assert.equal(
    await execution.filesystem.readFile(
      '/data/uploads/11111111-1111-4111-8111-111111111111.txt',
      { encoding: 'utf8' },
    ),
    'Historical file data',
  );
  assert.equal(
    await execution.filesystem.readFile('/data/workspace/report.txt', {
      encoding: 'utf8',
    }),
    'changed target\n',
  );
  assert.equal(
    await readFile('/data/private/agent/auth.json', 'utf8'),
    '{"type":"oauth","access":"private-model-token-for-migration","refresh":"private-refresh-token-for-migration","expires":0}',
  );
  const response = await fetch(
    'http://127.0.0.1:3000/files/11111111-1111-4111-8111-111111111111/download',
  );
  assert.equal(await response.text(), 'Historical file data');
  console.log(
    'PASS: historical native file paths, private authentication, and canonical download',
  );
} finally {
  await execution.sandbox._stop();
}

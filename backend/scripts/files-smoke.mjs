import 'dotenv/config';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { NestFactory } from '@nestjs/core';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DatabaseService } from '../dist/database/database.service.js';
import { configureApp } from '../dist/config/configure-app.js';
import { validateEnvironment } from '../dist/config/configuration.js';

const baseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@localhost:5433/pal_test';
assert(
  new URL(baseUrl).pathname.endsWith('_test'),
  'Use a test database connection',
);
const databaseName = 'pal_files_' + randomUUID().replaceAll('-', '') + '_test';
const databaseUrl = new URL(baseUrl);
databaseUrl.pathname = '/' + databaseName;
const admin = new Pool({ connectionString: baseUrl });
const directory = await mkdtemp('/data/private/pal-files-smoke-');
const code = 'FILE-' + randomUUID().slice(0, 8).toUpperCase();
const palette = [
  ['red', [235, 35, 35]],
  ['blue', [35, 65, 235]],
  ['green', [30, 165, 55]],
  ['yellow', [245, 220, 30]],
];
const left = palette.splice(randomInt(palette.length), 1)[0];
const right = palette[randomInt(palette.length)];

// Disposable visual fixture: two solid panels. No answer labels are embedded.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
const pixels = Buffer.alloc(200 * (400 * 3 + 1));
for (let y = 0; y < 200; y++)
  for (let x = 0; x < 400; x++) {
    const color = x < 200 ? left[1] : right[1];
    for (let c = 0; c < 3; c++) pixels[y * 1201 + 1 + x * 3 + c] = color[c];
  }
const header = Buffer.alloc(13);
header.writeUInt32BE(400);
header.writeUInt32BE(200, 4);
header[8] = 8;
header[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
// Minimal one-page PDF fixture with a reference code in its visible text.
const pdfText = `Validation document: the exact reference code is ${code}.`;
const pdfStream = `BT /F1 14 Tf 30 750 Td (${pdfText}) Tj ET`;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(pdfStream)} >>\nstream\n${pdfStream}\nendstream`,
];
let pdfBody = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdfBody));
  pdfBody += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdfBody);
pdfBody += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
  .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdf = Buffer.from(pdfBody);
let app;
let root;
let databaseCreated = false;
let storage;
const limit = setTimeout(() => {
  console.error('FAIL: file smoke timed out');
  process.exitCode = 1;
  void app?.close();
}, 300_000);
const config = validateEnvironment({
  ...process.env,
  DATABASE_URL: databaseUrl.toString(),
  PAL_UPLOAD_DIR: join(directory, 'uploads'),
  PAL_AGENT_WORKING_DIR: '/home/pal/workspace',
  PAL_AGENT_AUTH_PATH: resolve(
    process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json',
  ),
  PAL_DESKTOP_ENABLED: 'false',
  HOST: '127.0.0.1',
  PORT: 3000,
});
async function start() {
  const { AppModule } = await import('../dist/app.module.js');
  app = await NestFactory.create(AppModule, {
    forceCloseConnections: true,
    logger: ['error', 'warn'],
  });
  const database = app.get(DatabaseService);
  await migrate(database.db, { migrationsFolder: './migrations' });
  app.useLogger(['error', 'warn']);
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  root = await app.getUrl();
}
async function json(path, body) {
  const response = await fetch(
    root + path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        }
      : { signal: AbortSignal.timeout(60000) },
  );
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
async function upload(filename, bytes, type) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const response = await fetch(root + '/files', { method: 'POST', body: form });
  assert(response.ok, 'Upload failed');
  return (await response.json()).attachment;
}
async function finalFor(taskId, after = 0) {
  const end = Date.now() + 210000;
  while (Date.now() < end) {
    const ids =
      taskId === null
        ? [null]
        : taskId
          ? [taskId]
          : (await json('/tasks?limit=100')).tasks.map((task) => task.id);
    for (const id of ids) {
      const { messages } = await json(
        '/chat/history?limit=100' + (id ? '&taskId=' + id : ''),
      );
      const output = messages.find(
        (message) =>
          message.role === 'assistant' &&
          (id === null || message.phase === 'final_answer') &&
          message.sequence > after,
      );
      if (output) return output;
    }
    await delay(500);
  }
  throw new Error(taskId === null ? 'No Main final' : 'No task final');
}
try {
  await readFile(config.PAL_AGENT_AUTH_PATH); // Check availability without printing credentials.
  await admin.query('CREATE DATABASE "' + databaseName + '"');
  databaseCreated = true;
  // ConfigModule validates the isolated test database and private upload paths.
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.PAL_UPLOAD_DIR = config.PAL_UPLOAD_DIR;
  process.env.PAL_DESKTOP_ENABLED = 'false';
  await start();
  const document = await upload('input.pdf', pdf, 'application/pdf');
  const image = await upload('visual.png', png, 'image/png');
  const original = await json('/chat/messages', {
    idempotencyKey: randomUUID(),
    attachmentIds: [document.id, image.id],
    text: 'What is the exact reference code in the attached PDF, and what are the colors of the left and right panels in the picture? Please answer directly.',
  });
  const inspected = await finalFor(null);
  assert(inspected.text.includes(code), 'Main did not read the document');
  assert(
    inspected.text.toLowerCase().includes(left[0]) &&
      inspected.text.toLowerCase().includes(right[0]),
    'Main did not read the image',
  );
  await json('/chat/messages', {
    idempotencyKey: randomUUID(),
    attachmentIds: [],
    replyToMessageId: original.messageId,
    text: 'Use a task for this validation. Have the task call its native agent-worker tool for an independent verification of the quoted PDF and picture. The worker must use native workspace read_file on both supplied local paths and return the exact reference code and panel colors. Wait for that worker result before creating the outputs, even though Main already inspected the files. Create report.txt containing the document’s exact reference code and the colors of the left and right image panels. Make an unchanged copy of the attached image named result.png. Declare report.txt and result.png together in the files array of your structured final answer, with local paths, download filenames, and contentType. Do not call external services.',
  });
  const result = await finalFor();
  assert.equal(
    result.attachments.length,
    2,
    'Task final needs document and image',
  );
  const reportFile = result.attachments.find(
    (file) => file.filename === 'report.txt',
  );
  const imageFile = result.attachments.find(
    (file) => file.filename === 'result.png',
  );
  assert(reportFile && imageFile, 'Expected report.txt and result.png');
  const imageResponse = await fetch(root + `/files/${imageFile.id}/download`);
  assert(imageResponse.ok);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
  const response = await fetch(root + `/files/${reportFile.id}/download`);
  assert(response.ok);
  const report = await response.text();
  assert(report.includes(code), 'Document contents missing');
  assert(
    report.toLowerCase().includes(left[0]) &&
      report.toLowerCase().includes(right[0]),
    'Visual contents missing',
  );
  const taskHistory = await json(
    `/chat/history?taskId=${result.taskId}&limit=100`,
  );
  assert.deepEqual(
    taskHistory.messages.find((message) => message.id === result.id),
    result,
  );
  while (app.get(AgentActivityService).current().status !== 'idle')
    await delay(100);
  await app.close();
  app = undefined;
  storage = new PostgresStore({
    id: 'pal-files-smoke-storage',
    connectionString: databaseUrl.toString(),
    schemaName: 'mastra',
  });
  await storage.init();
  const threadId = 'pal-task:' + result.taskId;
  const memoryStore = await storage.getStore('memory');
  const saved = await memoryStore.listMessages({ threadId, perPage: false });
  assert(
    saved.messages.some((message) =>
      message.content.parts.some(
        (part) =>
          part.type === 'tool-invocation' &&
          part.toolInvocation.toolName === 'agent-worker' &&
          part.toolInvocation.state === 'result',
      ),
    ),
    'No completed native worker delegation',
  );
  const mainHistory = await memoryStore.listMessages({
    threadId: 'pal-main',
    perPage: false,
  });
  for (const input of [document, image])
    assert(
      mainHistory.messages.some((message) =>
        message.content.parts.some(
          (part) =>
            part.type === 'tool-invocation' &&
            part.toolInvocation.toolName ===
              WORKSPACE_TOOLS.FILESYSTEM.READ_FILE &&
            part.toolInvocation.state === 'result' &&
            String(part.toolInvocation.args?.path).includes(input.id),
        ),
      ),
      `Main did not inspect ${input.filename} before routing`,
    );
  // Compress settled records using the public storage and Memory APIs.
  const memory = new Memory({
    storage,
    options: {
      lastMessages: false,
      semanticRecall: false,
      workingMemory: { enabled: false },
      observationalMemory: {
        model: chatgptModel(
          config.PAL_AGENT_MODEL,
          config.PAL_AGENT_AUTH_PATH,
          config.PAL_AGENT_THINKING_EFFORT,
        ),
        scope: 'thread',
        observation: { messageTokens: 1, bufferTokens: false, maxRetries: 0 },
      },
    },
  });
  const om = await memory.omEngine;
  await om.updateRecordConfig(threadId, 'pal-owner', {
    observation: { messageTokens: 1, bufferTokens: false },
  });
  const observation = await om.observe({ threadId, resourceId: 'pal-owner' });
  assert(observation.observed, 'Task memory observation did not run');
  await om.updateRecordConfig(threadId, 'pal-owner', {
    observation: { messageTokens: 30000 },
  });
  console.log(
    'PASS: real HTTP upload, Main read-only document/image inspection, native worker reading, structured Task file delivery and download',
  );
  await memory.settled();
  await storage.close();
  storage = undefined;
  await start();
  await json('/chat/messages', {
    idempotencyKey: randomUUID(),
    taskId: result.taskId,
    attachmentIds: [],
    text: `Reopen the original attached document from public message #1 using inspect_message and read its current local path. Reply with its exact reference code. This validates restart access.`,
  });
  const reopened = await finalFor(result.taskId, result.sequence);
  assert(
    reopened.text.includes(code),
    'Earlier document unavailable after restart',
  );
  const earlier = await fetch(root + `/files/${reportFile.id}/download`);
  assert.equal(await earlier.text(), report);
  console.log(
    'PASS: original file reopened and prior output bytes preserved after memory compression and backend restart',
  );
} finally {
  clearTimeout(limit);
  await app?.close();
  await storage?.close();
  if (databaseCreated)
    await admin
      .query('DROP DATABASE "' + databaseName + '" WITH (FORCE)')
      .catch(() =>
        console.error(
          'Disposable database cleanup failed; original validation result retained.',
        ),
      );

  await admin.end();
  await rm(directory, { recursive: true, force: true });
}

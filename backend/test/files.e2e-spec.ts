import { randomUUID } from 'node:crypto';
import {
  readdir,
  readFile,
  writeFile,
  truncate,
  symlink,
  utimes,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { UserVisibleMessage } from '../dist/chat/chat.types.js';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { startTestApp, openStream, until } from './helpers.js';
import { ExecutionService } from '../dist/execution/execution.service.js';
import { ApplicationFileStorage } from '../dist/files/application-file-storage.js';
import { FilesService } from '../dist/files/files.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { ChatService } from '../dist/chat/chat.service.js';
const submitted: UserVisibleMessage[] = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0YkAAAAASUVORK5CYII=',
  'base64',
);
let fixture: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  fixture = await startTestApp({
    runtimeFactory: () => ({
      async submit(message) {
        submitted.push(message);
      },
    }),
  });
});
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.reset();
  submitted.length = 0;
});

it('uploads six files separately and preserves their order in history and downloads', async () => {
  const bytes = png;
  const uploads = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      request(fixture.url)
        .post('/files')
        .attach('file', bytes, {
          filename: index === 0 ? '照片.png' : `image-${index}.png`,
          contentType: 'image/png',
        })
        .expect(201),
    ),
  );
  const ids: string[] = uploads.map((response) => response.body.attachment.id);
  const files = fixture.app.get(FilesService);
  const storage = fixture.app.get(ApplicationFileStorage);
  const sandbox = fixture.app.get(ExecutionService).sandbox;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const originalWrite = sandbox.writeFiles.bind(sandbox);
  const open = vi.spyOn(storage, 'open');
  const write = vi
    .spyOn(sandbox, 'writeFiles')
    .mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return originalWrite(...args);
    });
  const pending = Promise.all([
    files.manifest(ids.slice(0, 3)),
    files.manifest(ids.slice(3)),
  ]);
  try {
    await entered.promise;
    expect(open).toHaveBeenCalledTimes(1);
    release.resolve();
    const materialized = (await pending).flat();
    expect(materialized.map((file) => file.id)).toEqual(ids);
    expect(await readFile(materialized[0].path)).toEqual(bytes);

    write.mockRejectedValueOnce(new Error('Copy interrupted'));
    await expect(files.manifest([ids[0]])).rejects.toThrow('Copy interrupted');
    expect((await files.manifest([ids[0]]))[0].id).toBe(ids[0]);
  } finally {
    release.resolve();
    await pending.catch(() => {});
    open.mockRestore();
    write.mockRestore();
  }
  const input = { idempotencyKey: randomUUID(), text: '', attachmentIds: ids };
  const sent = (
    await request(fixture.url).post('/chat/messages').send(input).expect(201)
  ).body as { messageId: string };
  await request(fixture.url).post('/chat/messages').send(input).expect(201);
  expect(submitted).toHaveLength(1);
  expect(submitted[0].attachments.map((file) => file.id)).toEqual(ids);
  await request(fixture.url)
    .post('/chat/messages')
    .send({
      ...input,
      idempotencyKey: randomUUID(),
      attachmentIds: [randomUUID()],
    })
    .expect(400);
  const history = await request(fixture.url).get('/chat/history').expect(200);
  const message = history.body.messages.find(
    (m: { id: string }) => m.id === sent.messageId,
  );
  expect(message.attachments.map((file: { id: string }) => file.id)).toEqual(
    ids,
  );
  expect(message.attachments[0]).not.toHaveProperty('storageFilename');
  expect(message.attachments[0].filename).toBe('照片.png');
  const download = await request(fixture.url)
    .get(`/files/${ids[0]}/download`)
    .expect(200);
  expect(download.body).toEqual(bytes);
  expect(download.headers['content-disposition']).toMatch(/^attachment;/);
  const inline = await request(fixture.url)
    .get(`/files/${ids[0]}/content`)
    .expect(200);
  expect(inline.headers['content-disposition']).toMatch(/^inline;/);
  expect(inline.headers['x-content-type-options']).toBe('nosniff');
  await fixture.database.db.execute(
    sql`update attachments set created_at = now() - interval '2 days'`,
  );
  await fixture.app.get(FilesService).cleanup();
  await request(fixture.url).get(`/files/${ids[0]}/download`).expect(200);
});

it('rejects oversized or malformed uploads and removes abandoned attachments', async () => {
  const before = (await readdir(fixture.uploads)).filter(
    (name) => name !== 'incoming',
  ).length;
  await request(fixture.url)
    .post('/files')
    .attach('file', Buffer.alloc(25_000_001), 'large.bin')
    .expect(413);
  await request(fixture.url)
    .post('/files')
    .attach('file', Buffer.from('a'), 'a.txt')
    .attach('file', Buffer.from('b'), 'b.txt')
    .expect(400);
  await request(fixture.url)
    .post('/files')
    .field('unexpected', 'field')
    .expect(400);
  expect(
    (await readdir(fixture.uploads)).filter((name) => name !== 'incoming')
      .length,
  ).toBe(before);
  const uploaded = await request(fixture.url)
    .post('/files')
    .attach('file', Buffer.from('orphan'), 'orphan.txt')
    .expect(201);
  const files = fixture.app.get(FilesService);
  const [copy] = await files.manifest([uploaded.body.attachment.id]);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(copy.path, old, old);
  const unrelated = join(copy.path, '..', 'user-notes.txt');
  await writeFile(unrelated, 'Keep user files');
  await utimes(unrelated, old, old);
  await fixture.database.db.execute(
    sql`update attachments set created_at = now() - interval '2 days' where id = ${uploaded.body.attachment.id}`,
  );
  const unavailable = vi
    .spyOn(fixture.app.get(ExecutionService).filesystem, 'readdir')
    .mockRejectedValueOnce(new Error('Execution is stopped'));
  await files.cleanup();
  expect(await readFile(copy.path, 'utf8')).toBe('orphan');
  unavailable.mockRestore();
  await fixture.app.get(FilesService).cleanup();
  await request(fixture.url)
    .get(`/files/${uploaded.body.attachment.id}/download`)
    .expect(404);
  expect(
    (await readdir(fixture.uploads)).filter((name) => name !== 'incoming')
      .length,
  ).toBe(before);
  await expect(readFile(copy.path)).rejects.toThrow();
  expect(await readFile(unrelated, 'utf8')).toBe('Keep user files');
});

it('imports immutable outputs, retains delivered files through messages, and expires unsent outputs', async () => {
  const files = fixture.app.get(FilesService);
  const tasks = fixture.app.get(TasksService);
  const chat = fixture.app.get(ChatService);
  const task = await tasks.create({
    title: 'Output files',
    goal: 'Send a report',
  });
  const source = join(fixture.uploads, 'report.txt');
  await writeFile(source, 'Original report');
  const linked = join(fixture.uploads, 'linked.txt');
  await symlink(source, linked);
  const document = await files.importFile({
    path: linked,
    filename: 'report.txt',
    contentType: 'text/plain',
  });
  const imagePath = join(fixture.uploads, 'generated.png');
  await writeFile(imagePath, png);
  const image = await files.importFile({ path: imagePath });
  const ids = [document.id, image.id];
  await writeFile(source, 'Modified report');
  const unsent = await files.importFile({
    path: source,
    filename: 'unsent.txt',
  });
  const stream = await openStream(fixture.url);
  try {
    const output = await chat.publish({
      role: 'assistant',
      text: '',
      taskId: task.id,
      phase: 'final_answer',
      attachmentIds: ids,
    });
    await fixture.database.db.execute(
      sql`update attachments set created_at = now() - interval '2 days'`,
    );
    await files.cleanup();
    await request(fixture.url).get(`/files/${unsent.id}/download`).expect(404);
    expect(await tasks.details(task.id)).not.toHaveProperty('attachments');
    await until(() =>
      stream.events.some(
        (event) =>
          event.event === 'message.added' && event.message.id === output.id,
      ),
    );
    expect(
      (await chat.history({ taskId: task.id })).messages[0].attachments.map(
        (attachment) => attachment.id,
      ),
    ).toEqual(ids);
    const download = await request(fixture.url)
      .get(`/files/${document.id}/download`)
      .expect(200);
    expect(download.body.toString()).toBe('Original report');
    const manifest = await files.manifest(ids);
    expect(manifest[1].path).toMatch(/\.png$/);
    expect(await readFile(manifest[1].path)).toEqual(png);
    expect(output.attachments[0]).not.toHaveProperty('path');
    await request(fixture.url)
      .post('/chat/messages')
      .send({
        idempotencyKey: randomUUID(),
        text: 'Use this report',
        taskId: task.id,
        attachmentIds: [document.id],
      })
      .expect(201);
    expect(submitted.at(-1)?.taskId).toBe(task.id);
    await expect(
      chat.publish({
        role: 'assistant',
        text: 'Missing file',
        attachmentIds: [randomUUID()],
      }),
    ).rejects.toThrow('attachments do not exist');
  } finally {
    await stream.close();
  }
});

it('rejects invalid imports and downloads unverified images as files', async () => {
  const files = fixture.app.get(FilesService);
  const before = await readdir(fixture.uploads);
  await expect(files.importFile({ path: fixture.uploads })).rejects.toThrow(
    'regular file',
  );
  await expect(
    files.importFile({ path: join(fixture.uploads, 'missing') }),
  ).rejects.toThrow('not readable');
  const large = join(fixture.uploads, 'large-output.bin');
  await writeFile(large, '');
  await truncate(large, 25_000_001);
  await expect(files.importFile({ path: large })).rejects.toThrow('25 MB');
  expect(
    (await readdir(fixture.uploads)).filter((name) => !before.includes(name)),
  ).toEqual(['large-output.bin']);
  const fake = await request(fixture.url)
    .post('/files')
    .attach('file', Buffer.from('<svg>active content</svg>'), {
      filename: 'fake.png',
      contentType: 'image/png',
    })
    .expect(201);
  await request(fixture.url)
    .get(`/files/${fake.body.attachment.id}/content`)
    .expect(200)
    .expect('Content-Type', 'application/octet-stream');
});

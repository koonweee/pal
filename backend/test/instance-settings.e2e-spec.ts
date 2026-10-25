import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { startTestApp, openStream, until } from './helpers.js';
import { FilesService } from '../dist/files/files.service.js';
import { InstanceSettingsService } from '../dist/instance-settings/instance-settings.service.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0YkAAAAASUVORK5CYII=',
  'base64',
);
let fixture: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  fixture = await startTestApp();
});
afterAll(async () => fixture?.close());
beforeEach(async () => fixture.reset());
const upload = async (bytes = png) =>
  (
    await request(fixture.url)
      .post('/files')
      .attach('file', bytes, {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(201)
  ).body.attachment.id as string;

it('shares normalized settings, preserves omitted fields, and publishes a refresh hint', async () => {
  const initial = (
    await request(fixture.url).get('/instance-settings').expect(200)
  ).body;
  expect(initial).toEqual({
    agentName: 'pal',
    agentAvatarAttachmentId: null,
    accentColor: '#0066d6',
    version: 0,
  });
  const stream = await openStream(fixture.url);
  try {
    const avatar = await upload();
    const saved = (
      await request(fixture.url)
        .patch('/instance-settings')
        .send({
          agentName: '  Nova  ',
          agentAvatarAttachmentId: avatar,
          accentColor: '#C026D3',
        })
        .expect(200)
    ).body;
    expect(saved).toEqual({
      agentName: 'Nova',
      agentAvatarAttachmentId: avatar,
      accentColor: '#c026d3',
      version: 1,
    });
    await until(() =>
      stream.events.some((e) => e.event === 'instance.settings.updated'),
    );
    const changed = (
      await request(fixture.url)
        .patch('/instance-settings')
        .send({ agentName: 'Pal Two' })
        .expect(200)
    ).body;
    expect(changed).toEqual({ ...saved, agentName: 'Pal Two', version: 2 });
    expect(
      (await request(fixture.url).get('/instance-settings').expect(200)).body,
    ).toEqual(changed);
    expect(
      (
        await fixture.database.pool.query(
          'select count(*) from instance_settings',
        )
      ).rows[0].count,
    ).toBe('1');
  } finally {
    await stream.close();
  }
});

it('rejects invalid names, colors, and non-PNG or excessive avatar files', async () => {
  for (const input of [
    { agentName: '   ' },
    { agentName: 'x'.repeat(61) },
    { agentName: null },
    { accentColor: 'red' },
    { accentColor: null },
    { agentAvatarAttachmentId: 'invalid' },
  ])
    await request(fixture.url)
      .patch('/instance-settings')
      .send(input)
      .expect(400);
  const invalid = await upload(Buffer.from('<svg>not a png</svg>'));
  await request(fixture.url)
    .patch('/instance-settings')
    .send({ agentAvatarAttachmentId: invalid })
    .expect(400);
  const large = await upload(Buffer.concat([png, Buffer.alloc(2_000_000)]));
  await request(fixture.url)
    .patch('/instance-settings')
    .send({ agentAvatarAttachmentId: large })
    .expect(400);
  const wide = Buffer.from(png);
  wide.writeUInt32BE(2049, 16);
  const dimensions = await upload(wide);
  await request(fixture.url)
    .patch('/instance-settings')
    .send({ agentAvatarAttachmentId: dimensions })
    .expect(400);
  expect(
    (await request(fixture.url).get('/instance-settings')).body.version,
  ).toBe(0);
});

it('retains the saved avatar and expires it after replacement or reset', async () => {
  const first = await upload(),
    second = await upload();
  await fixture.database.db.execute(
    sql`update attachments set created_at = now() - interval '2 days'`,
  );
  await request(fixture.url)
    .patch('/instance-settings')
    .send({ agentAvatarAttachmentId: first })
    .expect(200);
  const files = fixture.app.get(FilesService);
  await files.cleanup();
  await request(fixture.url).get(`/files/${first}/content`).expect(200);
  await request(fixture.url).get(`/files/${second}/content`).expect(404);
  const replacement = await upload();
  await request(fixture.url)
    .patch('/instance-settings')
    .send({ agentAvatarAttachmentId: replacement })
    .expect(200);
  await files.cleanup();
  await request(fixture.url).get(`/files/${first}/content`).expect(404);
  await fixture.database.db.execute(
    sql`update attachments set created_at = now() - interval '2 days'`,
  );
  await request(fixture.url)
    .patch('/instance-settings')
    .send({ agentAvatarAttachmentId: null })
    .expect(200);
  await files.cleanup();
  await request(fixture.url).get(`/files/${replacement}/content`).expect(404);
});

it('uses the original profile PNG for installation icons and preserves app identity and fallbacks', async () => {
  const manifest = () =>
    request(fixture.url).get('/manifest.webmanifest').expect(200);
  let response = await manifest();
  expect(response.headers['content-type']).toContain(
    'application/manifest+json',
  );
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toMatchObject({ name: 'Pal', id: '/', start_url: '/' });
  expect(response.body.icons.map((icon: { src: string }) => icon.src)).toEqual([
    '/icons/pal-production-192.png',
    '/icons/pal-production-512.png',
  ]);
  const id = await upload();
  await request(fixture.url)
    .patch('/instance-settings')
    .send({ agentAvatarAttachmentId: id })
    .expect(200);
  response = await manifest();
  expect(response.body.icons).toEqual([
    {
      src: `/api/files/${id}/content`,
      sizes: '1x1',
      type: 'image/png',
      purpose: 'any',
    },
  ]);
  for (const path of [
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
  ]) {
    const redirect = await request(fixture.url).get(path).expect(302);
    expect(redirect.headers.location).toBe(`/api/files/${id}/content`);
    expect(redirect.headers['cache-control']).toBe('no-store');
  }
  const content = await request(fixture.url)
    .get(`/files/${id}/content`)
    .expect(200);
  expect(content.body).toEqual(png);
  const config = fixture.app.get(ConfigService);
  config.set('PAL_APP_VARIANT', 'dev');
  try {
    expect((await manifest()).body).toMatchObject({
      name: 'Pal Dev',
      id: '/pal-dev',
    });
    await request(fixture.url)
      .patch('/instance-settings')
      .send({ agentAvatarAttachmentId: null })
      .expect(200);
    expect((await manifest()).body.icons[0].src).toBe('/icons/pal-192.png');
    const fallback = await request(fixture.url)
      .get('/apple-touch-icon.png')
      .expect(302);
    expect(fallback.headers.location).toBe('/icons/apple-touch-icon.png');
    await request(fixture.url)
      .patch('/instance-settings')
      .send({ agentAvatarAttachmentId: id })
      .expect(200);
    const settings = fixture.app.get(InstanceSettingsService);
    const spy = vi
      .spyOn(settings, 'get')
      .mockResolvedValue({
        ...(await settings.get()),
        agentAvatarAttachmentId: '00000000-0000-4000-8000-000000000000',
      });
    try {
      expect((await manifest()).body.icons[0].src).toBe('/icons/pal-192.png');
    } finally {
      spy.mockRestore();
    }
  } finally {
    config.set('PAL_APP_VARIANT', 'production');
  }
});

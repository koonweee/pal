import request from 'supertest';
import { startTestApp } from './helpers.js';

let fixture: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  fixture = await startTestApp();
});
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.reset();
});

it('lets the human manage and audit a preference with version conflicts', async () => {
  const created = await request(fixture.url)
    .post('/preferences')
    .send({
      topic: 'writing',
      statement: 'Use concise prose.',
      reason: 'Added in preferences settings.',
    })
    .expect(201);
  expect(created.body).toMatchObject({
    version: 1,
    basis: 'user-stated',
    status: 'active',
    sources: [],
  });

  const changed = await request(fixture.url)
    .patch(`/preferences/${created.body.id}`)
    .send({
      expectedVersion: 1,
      appliesWhen: 'Professional writing',
      reason: 'Clarified applicability.',
    })
    .expect(200);
  expect(changed.body).toMatchObject({
    version: 2,
    appliesWhen: 'Professional writing',
    sourceMessageIds: [],
  });
  const conflict = await request(fixture.url)
    .patch(`/preferences/${created.body.id}`)
    .send({
      expectedVersion: 1,
      statement: 'Use long prose.',
      reason: 'Stale edit.',
    })
    .expect(409);
  expect(conflict.body.current).toMatchObject({
    id: created.body.id,
    version: 2,
  });

  const list = await request(fixture.url)
    .get('/preferences')
    .query({ queries: 'professional concise' })
    .expect(200);
  expect(list.body.preferences.map((item: { id: string }) => item.id)).toEqual([
    created.body.id,
  ]);
  const history = await request(fixture.url)
    .get(`/preferences/${created.body.id}/history`)
    .expect(200);
  expect(history.body.revisions).toMatchObject([
    { version: 2, actor: 'human' },
    { version: 1, actor: 'human' },
  ]);
});

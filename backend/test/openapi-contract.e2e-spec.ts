import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Ajv, { type ValidateFunction } from 'ajv';
import request from 'supertest';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { openStream, startTestApp, until } from './helpers.js';

let fixture: Awaited<ReturnType<typeof startTestApp>>;
let validateSchema: (name: string, value: unknown) => void;

function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema);
  if (!value || typeof value !== 'object') return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, jsonSchema(entry)]),
  );
  if (normalized.nullable !== true) return normalized;
  delete normalized.nullable;
  if (
    '$ref' in normalized ||
    'allOf' in normalized ||
    'oneOf' in normalized ||
    'anyOf' in normalized
  )
    return {
      anyOf: [normalized, { type: 'null' }],
    };
  if (Array.isArray(normalized.enum)) normalized.enum.push(null);
  if (typeof normalized.type === 'string')
    normalized.type = [normalized.type, 'null'];
  return normalized;
}

beforeAll(async () => {
  fixture = await startTestApp();
  const document = jsonSchema(
    JSON.parse(await readFile('openapi/first-party-v1.json', 'utf8')),
  ) as object;
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
  ajv.addSchema(document, 'openapi');
  const validators = new Map<string, ValidateFunction>();
  validateSchema = (name, value) => {
    let validate = validators.get(name);
    if (!validate) {
      validate = ajv.compile({
        $ref: `openapi#/components/schemas/${name}`,
      });
      validators.set(name, validate);
    }
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  };
});
afterAll(async () => fixture.close());
beforeEach(async () => fixture.reset());

it('matches representative HTTP responses to the generated schemas', async () => {
  const accepted = await request(fixture.url)
    .post('/chat/messages')
    .send({
      destinationId: 'web',
      idempotencyKey: randomUUID(),
      text: 'Contract check',
      attachmentIds: [],
    })
    .expect(201);
  validateSchema('MessageAcceptedResponseDto', accepted.body);

  const history = await request(fixture.url).get('/chat/history').expect(200);
  validateSchema('HistoryPageResponseDto', history.body);

  await fixture.app.get(TasksService).create({
    title: 'Contract task',
    goal: 'Validate task responses',
  });
  const tasks = await request(fixture.url).get('/tasks').expect(200);
  validateSchema('TaskPageResponseDto', tasks.body);
  const detail = await request(fixture.url)
    .get(`/tasks/details/${tasks.body.tasks[0].id}`)
    .expect(200);
  validateSchema('TaskDetailsEnvelopeResponseDto', detail.body);

  const upload = await request(fixture.url)
    .post('/files')
    .attach('file', Buffer.from('contract'), 'contract.txt')
    .expect(201);
  validateSchema('AttachmentResponseDto', upload.body.attachment);

  const preference = await request(fixture.url)
    .post('/preferences')
    .send({
      topic: 'contract',
      statement: 'Keep the contract generated.',
      reason: 'Contract test.',
    })
    .expect(201);
  validateSchema('PreferenceResponseDto', preference.body);

  const settings = await request(fixture.url)
    .get('/instance-settings')
    .expect(200);
  validateSchema('InstanceSettingsResponseDto', settings.body);

  const mcp = await request(fixture.url).get('/mcp/servers').expect(200);
  validateSchema('McpSnapshotResponseDto', mcp.body);

  const invalid = await request(fixture.url)
    .post('/chat/messages')
    .send({ text: '' })
    .expect(400);
  validateSchema('ApplicationErrorResponseDto', invalid.body);
});

it('matches a real SSE envelope and documents binary file responses', async () => {
  const stream = await openStream(fixture.url);
  try {
    await until(() => stream.events.length > 0);
    validateSchema('AgentActivityEventResponseDto', stream.events[0]);
  } finally {
    await stream.close();
  }

  const document = JSON.parse(
    await readFile('openapi/first-party-v1.json', 'utf8'),
  ) as {
    paths: Record<
      string,
      Record<string, { responses: Record<string, object> }>
    >;
  };
  for (const path of ['/files/{id}/content', '/files/{id}/download']) {
    expect(document.paths[path]?.get?.responses).toHaveProperty(
      '200.content.application/octet-stream',
    );
  }
});

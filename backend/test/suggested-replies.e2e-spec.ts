import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AGENT_RUNTIME,
  AgentHandoffError,
} from '../dist/agent/agent-runtime.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { openStream, startTestApp, until } from './helpers.js';

let fixture: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  fixture = await startTestApp();
});
afterAll(async () => fixture.close());
beforeEach(async () => fixture.reset());

it('continues the agent with selected text, broadcasts consumption, and retries a known handoff failure', async () => {
  const chat = fixture.app.get(ChatService);
  const source = await chat.publish({
    role: 'assistant',
    text: 'How many people?',
    suggestedReplies: ['Just me', 'Two people'],
  });
  const submit = vi
    .spyOn(fixture.app.get(AGENT_RUNTIME), 'submit')
    .mockRejectedValueOnce(new AgentHandoffError(false, 'Try again'))
    .mockResolvedValue(undefined);
  const streams = await Promise.all([
    openStream(fixture.url),
    openStream(fixture.url),
  ]);
  const input = {
    destinationId: 'web',
    suggestedReply: { messageId: source.id, index: 1 },
    idempotencyKey: randomUUID(),
  };
  try {
    await request(fixture.url).post('/chat/messages').send(input).expect(503);
    expect(await chat.get(source.id)).toMatchObject({
      suggestedReplies: [],
      version: 2,
    });
    const accepted = await request(fixture.url)
      .post('/chat/messages')
      .send(input)
      .expect(201);
    await request(fixture.url).post('/chat/messages').send(input).expect(201);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toMatchObject({
      id: accepted.body.messageId,
      role: 'user',
      text: 'Two people',
      replyToMessageId: null,
      attachments: [],
    });
    await request(fixture.url)
      .post('/chat/messages')
      .send({ ...input, destinationId: 'ios', idempotencyKey: randomUUID() })
      .expect(409);
    for (const stream of streams) {
      await until(() =>
        stream.events.some(
          (event) =>
            event.event === 'message.added' &&
            event.message.id === accepted.body.messageId,
        ),
      );
      expect(stream.events).toContainEqual(
        expect.objectContaining({
          event: 'message.updated',
          message: expect.objectContaining({
            id: source.id,
            suggestedReplies: [],
          }),
        }),
      );
    }
    const history = await request(fixture.url).get('/chat/history').expect(200);
    expect(
      history.body.messages.filter(
        (message: { role: string }) => message.role === 'user',
      ),
    ).toHaveLength(1);
  } finally {
    submit.mockRestore();
    await Promise.all(streams.map((stream) => stream.close()));
  }
});

import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  renderMarkdown,
  splitTelegramText,
} from '../dist/adapters/telegram/telegram-format.js';
import {
  TelegramDriver,
  classifyTelegramFailure,
  telegramOwnerEnvelope,
} from '../dist/adapters/telegram/telegram.driver.js';
import { ConfigService } from '@nestjs/config';
import type { SecondaryOutput } from '../dist/adapters/secondary/secondary-driver.js';

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string');
  return value;
}

it('accepts only the configured private owner and normalizes text, files, and quotes', () => {
  const update = {
    update_id: 10,
    message: {
      message_id: 20,
      from: { id: 7 },
      chat: { id: 7, type: 'private' },
      caption: 'caption',
      reply_to_message: { message_id: 19 },
      photo: [{ file_id: 'small' }, { file_id: 'large' }],
      document: {
        file_id: 'document',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      },
    },
  };
  expect(telegramOwnerEnvelope(update, '7')).toEqual({
    externalEventId: '10',
    externalMessageId: '20',
    externalThreadId: '7',
    text: 'caption',
    files: [
      { file_id: 'large' },
      {
        file_id: 'document',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      },
    ],
    replyToExternalMessageId: '19',
  });
  expect(telegramOwnerEnvelope(update, '8')).toBeNull();
  expect(
    telegramOwnerEnvelope(
      {
        ...update,
        message: { ...update.message, chat: { id: 7, type: 'group' } },
      },
      '7',
    ),
  ).toBeNull();
});

it('renders notification and reply intent and returns accepted references', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const driver = new TelegramDriver(
    new ConfigService({
      PAL_TELEGRAM_BOT_TOKEN: '1:test',
      PAL_TELEGRAM_OWNER_ID: '7',
    }),
    {} as never,
  );
  const outcome = await driver.send({
    deliveryId: 'delivery',
    notify: true,
    replyTo: { externalMessageId: '41', position: 0 },
    message: {
      text: 'hello',
      attachments: [],
    },
  } as SecondaryOutput);
  expect(outcome).toEqual({
    kind: 'accepted',
    references: [
      { externalMessageId: '42', externalThreadId: '7', position: 0 },
    ],
  });
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject(
    {
      chat_id: '7',
      text: 'hello',
      disable_notification: false,
      reply_parameters: { message_id: 41 },
    },
  );
  fetchMock.mockRestore();
});

it('marks a later part failure uncertain without requesting a retry', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 1 },
        }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    );
  const driver = new TelegramDriver(
    new ConfigService({
      PAL_TELEGRAM_BOT_TOKEN: '1:test',
      PAL_TELEGRAM_OWNER_ID: '7',
    }),
    {} as never,
  );
  const outcome = await driver.send({
    deliveryId: 'delivery',
    notify: false,
    message: { text: 'a'.repeat(4_001), attachments: [] },
  } as SecondaryOutput);
  expect(outcome).toEqual({
    kind: 'uncertain',
    code: 'partial_delivery',
    references: [
      { externalMessageId: '42', externalThreadId: '7', position: 0 },
    ],
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockRestore();
});

it('splits provider text and classifies only definite failures for retry', () => {
  expect(
    splitTelegramText(renderMarkdown('a'.repeat(8_001))).map(
      (part) => part.text.length,
    ),
  ).toEqual([4_000, 4_000, 1]);
  expect(
    classifyTelegramFailure(429, {
      error_code: 429,
      parameters: { retry_after: 3 },
    }),
  ).toEqual({
    kind: 'retryable',
    code: 'telegram_429',
    retryAfterMs: 3_000,
  });
  expect(classifyTelegramFailure(400, { error_code: 400 })).toEqual({
    kind: 'permanent',
    code: 'telegram_400',
  });
  expect(classifyTelegramFailure(200, { error_code: 429 })).toEqual({
    kind: 'retryable',
    code: 'telegram_429',
  });
});

it('renders Markdown and clips entity offsets across emoji-safe chunks', () => {
  const rendered = renderMarkdown(
    '😀 **bold** [site](https://example.com)\n\n# Title\n\n| A | B |\n| - | - |\n| x | y |\n\n<script>x</script>',
  );
  expect(rendered.text).toContain('😀 bold site');
  expect(rendered.text).toContain('A | B\nx | y');
  expect(rendered.text).toContain('<script>x</script>');
  expect(rendered.entities).toContainEqual({
    type: 'bold',
    offset: 3,
    length: 4,
  });
  expect(rendered.entities).toContainEqual({
    type: 'text_link',
    url: 'https://example.com/',
    offset: 8,
    length: 4,
  });
  const long = renderMarkdown(`**${'a'.repeat(3999)}😀end**`);
  const parts = splitTelegramText(long);
  expect(parts.map((p) => p.text).join('')).toBe(long.text);
  expect(parts[0].text.length).toBe(3999);
  expect(parts[1]).toEqual({
    text: '😀end',
    entities: [{ type: 'bold', offset: 0, length: 5 }],
  });
  expect(renderMarkdown('[reference]: https://example.com').text).toBe(
    '[reference]: https://example.com',
  );
  const code = renderMarkdown('**before `code` after**');
  const span = code.entities.find((e) => e.type === 'code')!;
  expect(
    code.entities
      .filter((e) => e.type === 'bold')
      .every(
        (e) =>
          e.offset + e.length <= span.offset ||
          e.offset >= span.offset + span.length,
      ),
  ).toBe(true);
});

it.each([6, 11])(
  'groups %i photos with a formatted caption, reply, and all provider IDs',
  async (count) => {
    let nextId = 40;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        const form = init!.body as FormData;
        const media = form.get('media');
        const result = media
          ? JSON.parse(requireString(media)).map(() => ({
              message_id: nextId++,
            }))
          : { message_id: nextId++ };
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
        });
      });
    try {
      const driver = new TelegramDriver(
        new ConfigService({
          PAL_TELEGRAM_BOT_TOKEN: '1:test',
          PAL_TELEGRAM_OWNER_ID: '7',
        }),
        {} as never,
      );
      const outcome = await driver.send({
        deliveryId: 'album',
        notify: false,
        replyTo: { externalMessageId: '24', position: 0 },
        message: {
          text: '**Nova** [source](https://example.com)',
          attachments: Array.from({ length: count }, (_, i) => ({
            id: String(i),
            filename: `${i}.png`,
            contentType: 'image/png',
          })),
        },
        openAttachment: async () => ({
          stream: Readable.from('image'),
          contentType: 'image/png',
          sizeBytes: 5,
        }),
      } as SecondaryOutput);
      expect(outcome).toEqual({
        kind: 'accepted',
        references: Array.from({ length: count }, (_, i) => ({
          externalMessageId: String(40 + i),
          externalThreadId: '7',
          position: i,
        })),
      });
      expect(fetchMock).toHaveBeenCalledTimes(Math.ceil(count / 10));
      expect(requireString(fetchMock.mock.calls[0][0])).toContain(
        '/sendMediaGroup',
      );
      const form = fetchMock.mock.calls[0][1]!.body as FormData;
      const media = JSON.parse(requireString(form.get('media')));
      expect(media).toHaveLength(Math.min(count, 10));
      expect(media[0]).toMatchObject({
        type: 'photo',
        media: 'attach://file0',
        caption: 'Nova source',
        caption_entities: expect.arrayContaining([
          { type: 'bold', offset: 0, length: 4 },
        ]),
      });
      expect(
        media
          .slice(1)
          .every((item: { caption?: string }) => item.caption === undefined),
      ).toBe(true);
      expect(form.get('reply_parameters')).toBe('{"message_id":24}');
      expect(form.get('disable_notification')).toBe('true');
      if (count === 11) {
        expect(requireString(fetchMock.mock.calls[1][0])).toContain(
          '/sendPhoto',
        );
        expect(
          (fetchMock.mock.calls[1][1]!.body as FormData).get('caption'),
        ).toBeNull();
      }
    } finally {
      fetchMock.mockRestore();
    }
  },
);

it('keeps long text before mixed attachments and retains album references on later failure', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: 30 } })),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          result: [{ message_id: 31 }, { message_id: 32 }],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 429 }), {
        status: 429,
      }),
    );
  try {
    const driver = new TelegramDriver(
      new ConfigService({
        PAL_TELEGRAM_BOT_TOKEN: '1:test',
        PAL_TELEGRAM_OWNER_ID: '7',
      }),
      {} as never,
    );
    const outcome = await driver.send({
      deliveryId: 'mixed',
      notify: true,
      message: {
        text: `**${'x'.repeat(1025)}**`,
        attachments: ['image/png', 'image/png', 'application/pdf'].map(
          (contentType, i) => ({
            id: String(i),
            filename: String(i),
            contentType,
          }),
        ),
      },
      openAttachment: async (attachment) => ({
        stream: Readable.from('file'),
        contentType: attachment.contentType,
        sizeBytes: 4,
      }),
    } as SecondaryOutput);
    expect(
      fetchMock.mock.calls.map((call) =>
        requireString(call[0]).split('/').at(-1),
      ),
    ).toEqual(['sendMessage', 'sendMediaGroup', 'sendDocument']);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]!.body as string),
    ).toMatchObject({
      text: 'x'.repeat(1025),
      entities: [{ type: 'bold', offset: 0, length: 1025 }],
    });
    const album = fetchMock.mock.calls[1][1]!.body as FormData;
    expect(
      JSON.parse(requireString(album.get('media'))).every(
        (item: { caption?: string }) => item.caption === undefined,
      ),
    ).toBe(true);
    expect(outcome).toEqual({
      kind: 'uncertain',
      code: 'partial_delivery',
      references: [30, 31, 32].map((id, position) => ({
        externalMessageId: String(id),
        externalThreadId: '7',
        position,
      })),
    });
  } finally {
    fetchMock.mockRestore();
  }
});

it('logs provider rejection details and redacted transport causes with delivery context', async () => {
  const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request: can't parse entities",
        }),
        { status: 400 },
      ),
    )
    .mockRejectedValueOnce(
      new TypeError(
        'fetch failed https://api.telegram.org/bot1:test/sendMessage',
        {
          cause: Object.assign(new Error('socket closed'), {
            code: 'ECONNRESET',
          }),
        },
      ),
    );
  try {
    const driver = new TelegramDriver(
      new ConfigService({
        PAL_TELEGRAM_BOT_TOKEN: '1:test',
        PAL_TELEGRAM_OWNER_ID: '7',
      }),
      {} as never,
    );
    const output = {
      deliveryId: 'delivery',
      notify: false,
      message: {
        id: 'message',
        text: 'private message contents',
        attachments: [],
      },
    } as SecondaryOutput;
    expect(await driver.send(output)).toEqual({
      kind: 'permanent',
      code: 'telegram_400',
    });
    expect(log.mock.calls[0]?.[0]).toContain(
      "Bad Request: can't parse entities",
    );
    expect(log.mock.calls[0]?.[0]).toContain('"httpStatus":400');
    expect(log.mock.calls[0]?.[0]).toContain('"deliveryId":"delivery"');
    expect(await driver.send(output)).toEqual({
      kind: 'uncertain',
      code: 'transport_uncertain',
    });
    const logs = JSON.stringify(log.mock.calls);
    expect(logs).toContain('ECONNRESET');
    expect(logs).toContain('[redacted]');
    expect(logs).not.toContain('1:test');
    expect(logs).not.toContain('private message contents');
  } finally {
    fetchMock.mockRestore();
    log.mockRestore();
  }
});

it('retries pre-TLS resets only before any message part is accepted', async () => {
  const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  const reset = new TypeError('fetch failed', {
    cause: Object.assign(
      new Error(
        'Client network socket disconnected before secure TLS connection was established',
      ),
      { code: 'ECONNRESET' },
    ),
  });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(reset);
  try {
    const driver = new TelegramDriver(
      new ConfigService({
        PAL_TELEGRAM_BOT_TOKEN: '1:test',
        PAL_TELEGRAM_OWNER_ID: '7',
      }),
      {} as never,
    );
    const output = {
      deliveryId: 'delivery',
      notify: false,
      message: { id: 'message', text: 'hello', attachments: [] },
    } as SecondaryOutput;
    expect(await driver.send(output)).toEqual({
      kind: 'retryable',
      code: 'transport_not_sent',
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })),
      )
      .mockRejectedValueOnce(reset);
    output.message.text = 'a'.repeat(8_001);
    expect(await driver.send(output)).toEqual({
      kind: 'uncertain',
      code: 'partial_delivery',
      references: [
        { externalMessageId: '42', externalThreadId: '7', position: 0 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    fetchMock.mockRestore();
    log.mockRestore();
  }
});

it('logs redacted polling transport causes', async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new TypeError(
      'fetch failed https://api.telegram.org/bot1:test/getUpdates',
      {
        cause: Object.assign(new Error('socket closed'), {
          code: 'ECONNRESET',
        }),
      },
    ),
  );
  const driver = new TelegramDriver(
    new ConfigService({
      PAL_TELEGRAM_BOT_TOKEN: '1:test',
      PAL_TELEGRAM_OWNER_ID: '7',
    }),
    { state: async () => ({ offset: 1 }) } as never,
  );
  try {
    await driver.start(async () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).toContain('ECONNRESET');
    expect(logs).toContain('socket closed');
    expect(logs).toContain('[redacted]');
    expect(logs).not.toContain('1:test');
  } finally {
    const stopped = driver.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    await stopped;
    fetchMock.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  }
});

it('uses native reactions and falls back only after known rejection or missing mapping', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  const driver = new TelegramDriver(
    new ConfigService({
      PAL_TELEGRAM_BOT_TOKEN: '1:test',
      PAL_TELEGRAM_OWNER_ID: '7',
    }),
    {} as never,
  );
  const output = {
    deliveryId: 'reaction',
    reaction: '👀',
    notify: false,
    message: { id: 'target' },
    replyTo: { externalMessageId: '42', position: 0 },
  } as SecondaryOutput;
  try {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: true })),
    );
    expect(await driver.send(output)).toEqual({
      kind: 'accepted',
      references: [],
    });
    expect(requireString(fetchMock.mock.calls[0][0])).toContain(
      'setMessageReaction',
    );
    expect(
      JSON.parse(requireString(fetchMock.mock.calls[0][1]?.body)),
    ).toMatchObject({
      message_id: 42,
      reaction: [{ type: 'emoji', emoji: '👀' }],
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 400 }), {
        status: 400,
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: 43 } })),
    );
    expect((await driver.send(output)).kind).toBe('accepted');
    expect(
      JSON.parse(requireString(fetchMock.mock.calls.at(-1)?.[1]?.body)),
    ).toMatchObject({ text: '👀', disable_notification: true });
    fetchMock.mockRejectedValueOnce(new Error('uncertain network failure'));
    const count = fetchMock.mock.calls.length;
    expect((await driver.send(output)).kind).toBe('uncertain');
    expect(fetchMock.mock.calls.length).toBe(count + 1);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: 44 } })),
    );
    expect((await driver.send({ ...output, replyTo: undefined })).kind).toBe(
      'accepted',
    );
    expect(requireString(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      'sendMessage',
    );
  } finally {
    fetchMock.mockRestore();
  }
});

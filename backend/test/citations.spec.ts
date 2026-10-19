import { publishTextProcessor } from '../dist/agent/publish-text.processor.js';
import { Agent } from '@mastra/core/agent';
import { wrapLanguageModel } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import {
  citationMiddleware,
  normalizeCitations,
} from '../dist/agent/citations.js';
const marker = '\uE200cite\uE202turn0search0\uE201';
function annotation(text: string) {
  return {
    type: 'url_citation',
    start_index: text.indexOf(marker),
    end_index: text.indexOf(marker) + marker.length,
    url: 'https://example.com/rules',
    title: 'Official "rules" [2026]',
  };
}
it('resolves JSON array citations safely, preserves links and strips unresolved markers', () => {
  const raw = JSON.stringify({
    text: [`Rules ${marker}`, '[Existing](https://example.com) ' + marker],
  });
  const result = normalizeCitations(raw, [annotation(raw)]);
  expect(JSON.parse(result.text).text).toEqual([
    'Rules [Official "rules" \\[2026\\]](<https://example.com/rules>)',
    '[Existing](https://example.com) ',
  ]);
  expect(result.unresolved).toBe(1);
  expect(normalizeCitations('[Existing](https://example.com)', []).text).toBe(
    '[Existing](https://example.com)',
  );
  expect(
    normalizeCitations(marker, [
      { ...annotation(marker), url: 'javascript:alert(1)' },
    ]),
  ).toEqual({ text: '', unresolved: 1 });
  expect(
    normalizeCitations('{"text":"\\ue200cite\\ue202turn0search0\\ue201"}', [])
      .text,
  ).toBe('{"text":""}');
});
it('handles Unicode offsets and multiple sources only for exact marker spans', () => {
  const raw = '🌟 ' + marker;
  const a = {
    ...annotation(raw),
    start_index: 2,
    end_index: 2 + marker.length,
  };
  expect(
    normalizeCitations(raw, [
      a,
      { ...a, url: 'https://example.org', title: 'Second' },
    ]).text,
  ).toContain('[Second](<https://example.org/>)');
  expect(
    normalizeCitations(raw, [{ ...a, start_index: 1000, end_index: 1010 }]),
  ).toEqual({ text: '🌟 ', unresolved: 1 });
});
it.each([false, true])(
  'normalizes native agent text before consumers (structured=%s)',
  async (structured) => {
    const raw = structured
      ? JSON.stringify({
          text: ['First ' + marker, 'Second'],
          replyTo: null,
          files: [],
          attachmentIds: [],
        })
      : 'Worker finding ' + marker;
    const a = annotation(raw);
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'answer' },
              { type: 'text-delta', id: 'answer', delta: raw.slice(0, 15) },
              { type: 'text-delta', id: 'answer', delta: raw.slice(15) },
              {
                type: 'text-end',
                id: 'answer',
                providerMetadata: {
                  openai: { annotations: [a], phase: 'final_answer' },
                },
              },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
          }),
        }),
      }),
      middleware: citationMiddleware,
    });
    const published: string[] = [];
    const agent = new Agent({
      id: 'citation-test',
      name: 'Citation test',
      instructions: 'Answer.',
      model,
      outputProcessors: structured
        ? [
            publishTextProcessor(async (output) => {
              published.push(output.text);
            }),
          ]
        : [],
    });
    const stream = await agent.stream('Answer.');
    for await (const _ of stream.fullStream) {
      /* consume */
    }
    const text = await stream.text;
    expect(text).toBe(normalizeCitations(raw, [a]).text);
    if (structured) expect(published).toEqual(JSON.parse(text).text);
  },
);

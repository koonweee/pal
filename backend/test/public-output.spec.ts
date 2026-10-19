import { parsePublicResponse } from '../dist/agent/public-output.js';

it('expands intentional messages with one quote and files on the last part', () => {
  const attachmentIds = ['10000000-0000-4000-8000-000000000001'];
  const files = [
    {
      path: '/tmp/report.txt',
      filename: 'report.txt',
      contentType: 'text/plain',
    },
  ];
  expect(
    parsePublicResponse(
      JSON.stringify({
        text: ['answer', 'workaround', 'alternative'],
        replyTo: 42,
        attachmentIds,
        files,
      }),
    ),
  ).toEqual([
    { text: 'answer', replyTo: 42, attachmentIds: [], files: [] },
    { text: 'workaround', replyTo: null, attachmentIds: [], files: [] },
    { text: 'alternative', replyTo: null, attachmentIds, files },
  ]);
  expect(
    parsePublicResponse(JSON.stringify({ text: 'not yet', replyTo: null })),
  ).toEqual([{ text: 'not yet', replyTo: null, attachmentIds: [], files: [] }]);
  for (const text of [[], ['answer', ''], ['answer', 7]])
    expect(() =>
      parsePublicResponse(JSON.stringify({ text, replyTo: null })),
    ).toThrow();
});

it('accepts text-only commentary while validating explicit reply references', () => {
  expect(
    parsePublicResponse(JSON.stringify({ text: 'checking the invoice…' })),
  ).toEqual([
    {
      text: 'checking the invoice…',
      replyTo: null,
      attachmentIds: [],
      files: [],
    },
  ]);
  expect(
    parsePublicResponse(
      JSON.stringify({ text: ['found a discrepancy', 'verifying the total'] }),
    ),
  ).toEqual([
    {
      text: 'found a discrepancy',
      replyTo: null,
      attachmentIds: [],
      files: [],
    },
    {
      text: 'verifying the total',
      replyTo: null,
      attachmentIds: [],
      files: [],
    },
  ]);
  for (const replyTo of [0, -1, 1.5, '42', false])
    expect(() =>
      parsePublicResponse(JSON.stringify({ text: 'update', replyTo })),
    ).toThrow();
});

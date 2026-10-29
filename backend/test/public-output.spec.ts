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
  for (const text of [
    ['answer', ''],
    ['answer', 7],
  ])
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

it('validates suggestions and attaches them only to the final message', () => {
  const suggestedReplies = ['Just me', 'Two people'];
  expect(
    parsePublicResponse(
      JSON.stringify({
        text: ['Dinner sounds good.', 'How many people?'],
        suggestedReplies,
      }),
    ),
  ).toEqual([
    {
      text: 'Dinner sounds good.',
      replyTo: null,
      attachmentIds: [],
      files: [],
    },
    {
      text: 'How many people?',
      replyTo: null,
      attachmentIds: [],
      files: [],
      suggestedReplies,
    },
  ]);
  for (const invalid of [
    null,
    'Yes',
    ['', 'No'],
    [' Yes ', 'Yes'],
    ['a', 'b', 'c', 'd'],
    ['x'.repeat(81)],
    ['two\nlines'],
    [7],
  ])
    expect(() =>
      parsePublicResponse(
        JSON.stringify({ text: 'Choose', suggestedReplies: invalid }),
      ),
    ).toThrow();
});

it('normalizes empty text arrays while preserving files and envelope validation', () => {
  expect(parsePublicResponse(JSON.stringify({ text: [] }))).toEqual([
    { text: '', replyTo: null, attachmentIds: [], files: [] },
  ]);
  const files = [
    {
      path: '/tmp/report.txt',
      filename: 'report.txt',
      contentType: 'text/plain',
    },
  ];
  expect(parsePublicResponse(JSON.stringify({ text: [], files }))).toEqual([
    { text: '', replyTo: null, attachmentIds: [], files },
  ]);
  for (const fields of [
    { replyTo: -1 },
    { attachmentIds: ['invented'] },
    { files: [{}] },
    { suggestedReplies: [7] },
  ])
    expect(() =>
      parsePublicResponse(JSON.stringify({ text: [], ...fields })),
    ).toThrow();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuaModelOutput } from './cua-output.mjs';

test('Cua structured MCP observations retain refs and native image content for the model', () => {
  const output = { refs: [{ ref: 'p1:2', name: 'Save' }], status: 'ok' };
  Object.defineProperty(output, Symbol.for('mastra.mcp.callToolContent'), {
    value: [
      { type: 'text', text: 'One action ref' },
      { type: 'image', data: 'PNG_DATA', mimeType: 'image/png' },
    ],
  });
  const model = cuaModelOutput(output);
  assert.equal(model.type, 'content');
  assert.match(model.value[0].text, /p1:2/);
  assert.match(model.value[0].text, /One action ref/);
  assert.doesNotMatch(model.value[0].text, /PNG_DATA/);
  assert.deepEqual(model.value[1], {
    type: 'media',
    data: 'PNG_DATA',
    mediaType: 'image/png',
  });
});

test('Cua refusal envelopes remain visible and do not duplicate image bytes into text', () => {
  const model = cuaModelOutput({
    isError: true,
    content: [{ type: 'text', text: 'stale target' }],
  });
  assert.match(model.value[0].text, /stale target/);
  assert.match(model.value[0].text, /"isError":true/);
});

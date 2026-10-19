import { readFile } from 'node:fs/promises';
import { renderedDocument } from './openapi-document.mjs';

const path = new URL('../openapi/first-party-v1.json', import.meta.url);
const expected = await renderedDocument();
const actual = await readFile(path, 'utf8').catch(() => '');
if (actual !== expected) {
  console.error('OpenAPI artifact is stale. Run npm run openapi:generate.');
  process.exitCode = 1;
}

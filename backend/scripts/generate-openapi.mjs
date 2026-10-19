import { mkdir, writeFile } from 'node:fs/promises';
import { renderedDocument } from './openapi-document.mjs';

await mkdir(new URL('../openapi/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../openapi/first-party-v1.json', import.meta.url),
  await renderedDocument(),
);

import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
const dir = new URL('./', import.meta.url);
const source = new URL('pal-browser.js', dir);
const hash = createHash('sha256')
  .update(readFileSync(source))
  .digest('hex')
  .slice(0, 16);
const filename = `pal-browser.${hash}.js`;
renameSync(source, new URL(filename, dir));
const manifestPath = new URL('manifest.json', dir);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.background.service_worker = filename;
writeFileSync(manifestPath, JSON.stringify(manifest));

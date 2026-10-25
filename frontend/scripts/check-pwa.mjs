import { readFile } from 'node:fs/promises';

const index = await readFile('dist/index.html', 'utf8');
const nginx = await readFile('nginx.conf', 'utf8');
for (const marker of [
  'viewport-fit=cover',
  'apple-mobile-web-app-capable',
  'apple-mobile-web-app-title',
  'rel="apple-touch-icon"',
  'href="/apple-touch-icon.png"',
  'rel="manifest"',
  'href="/manifest.webmanifest"',
]) {
  if (!index.includes(marker))
    throw new Error(`Built document is missing ${marker}.`);
}

if (
  !nginx.includes(
    'manifest\\.webmanifest|apple-touch-icon(-precomposed)?\\.png',
  )
)
  throw new Error('Installation metadata must proxy to the backend.');

for (const size of [192, 512]) {
  const icon = await readFile(`dist/icons/pal-production-${size}.png`);
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  if (width !== size || height !== size)
    throw new Error(`pal-production-${size}.png is ${width}x${height}.`);
}

const serviceWorker = await readFile('dist/sw.js', 'utf8');
const serviceWorkerSource = await readFile('src/pwa/sw.ts', 'utf8');
for (const route of [
  'manifest',
  'apple-touch-icon',
  'api',
  'stream',
  'desktop',
  'chat',
  'tasks',
  'files',
  'instance-settings',
  'preferences',
  'mcp',
  'notifications',
]) {
  if (!serviceWorker.includes(route))
    throw new Error(
      `Service worker is missing the ${route} network-only boundary.`,
    );
}
if (!serviceWorkerSource.includes('new NetworkOnly()'))
  throw new Error('Dynamic routes must use a NetworkOnly strategy.');
if (!serviceWorker.includes('SKIP_WAITING'))
  throw new Error(
    'Service worker must expose explicit waiting-worker activation.',
  );
if (!serviceWorkerSource.includes('event.waitUntil(self.skipWaiting())'))
  throw new Error(
    'Waiting-worker activation must extend the service-worker message event.',
  );
if (!serviceWorkerSource.includes('clientsClaim()'))
  throw new Error('Activated updates must claim open clients.');

console.log('PWA manifest, icons, and cache boundary are valid.');

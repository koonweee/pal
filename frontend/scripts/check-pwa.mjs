import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(
  await readFile('dist/manifest.webmanifest', 'utf8'),
);
const index = await readFile('dist/index.html', 'utf8');
const nginx = await readFile('nginx.conf', 'utf8');
if (manifest.name !== 'Pal' || manifest.short_name !== 'Pal')
  throw new Error('Manifest must use the native app name.');
if (
  manifest.display !== 'standalone' ||
  manifest.start_url !== '/' ||
  manifest.id !== '/'
)
  throw new Error('Manifest must launch the root app in standalone mode.');
for (const marker of [
  'viewport-fit=cover',
  'apple-mobile-web-app-capable',
  'apple-mobile-web-app-title',
  'rel="apple-touch-icon"',
  'sizes="180x180"',
  'href="data:image/png;base64,',
]) {
  if (!index.includes(marker))
    throw new Error(`Built document is missing ${marker}.`);
}

for (const marker of [
  'location = /apple-touch-icon.png',
  'location = /apple-touch-icon-precomposed.png',
  'try_files $uri =404',
  'default_type application/manifest+json',
]) {
  if (!nginx.includes(marker))
    throw new Error(`Production server is missing ${marker}.`);
}

const appleTouchIcon = await readFile('dist/apple-touch-icon.png');
const expectedAppleTouchIcon = await readFile(
  'dist/icons/pal-production-180.png',
);
const precomposedAppleTouchIcon = await readFile(
  'dist/apple-touch-icon-precomposed.png',
);
if (
  !appleTouchIcon.equals(expectedAppleTouchIcon) ||
  !precomposedAppleTouchIcon.equals(expectedAppleTouchIcon)
)
  throw new Error('Production Apple icon fallbacks use the wrong identity.');
const embeddedIconMatch = index.match(/href="data:image\/png;base64,([^"]+)"/);
if (
  !embeddedIconMatch ||
  !Buffer.from(embeddedIconMatch[1], 'base64').equals(appleTouchIcon)
)
  throw new Error('Built document does not embed the Apple touch icon.');
const appleTouchIconWidth = appleTouchIcon.readUInt32BE(16);
const appleTouchIconHeight = appleTouchIcon.readUInt32BE(20);
if (appleTouchIconWidth !== 180 || appleTouchIconHeight !== 180)
  throw new Error(
    `apple-touch-icon.png is ${appleTouchIconWidth}x${appleTouchIconHeight}.`,
  );

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

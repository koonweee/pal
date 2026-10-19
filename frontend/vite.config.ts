import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function pwaIcons(source: URL): Plugin {
  const icon = readFileSync(source);
  const href = `data:image/png;base64,${icon.toString('base64')}`;

  return {
    name: 'pal-pwa-icons',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', sizes: '180x180', href },
          injectTo: 'head',
        },
      ],
    },
    writeBundle(options) {
      if (!options.dir)
        throw new Error('PWA build requires an output directory.');
      for (const filename of [
        'apple-touch-icon.png',
        'apple-touch-icon-precomposed.png',
      ])
        writeFileSync(resolve(options.dir, filename), icon);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PAL_');
  const allowedHost =
    process.env.PAL_DEV_ALLOWED_HOST ?? env.PAL_DEV_ALLOWED_HOST;
  const developmentIdentity =
    (process.env.PAL_APP_VARIANT ?? env.PAL_APP_VARIANT) === 'dev';
  const iconPrefix = developmentIdentity ? 'pal' : 'pal-production';
  const appleTouchIcon = new URL(
    developmentIdentity
      ? './public/icons/apple-touch-icon.png'
      : './public/icons/pal-production-180.png',
    import.meta.url,
  );
  const releaseId =
    process.env.PAL_RELEASE_ID ?? env.PAL_RELEASE_ID ?? 'development';
  const proxy: Record<string, ProxyOptions> = {
    '/desktop': {
      target:
        process.env.PAL_DESKTOP_URL ??
        env.PAL_DESKTOP_URL ??
        'http://127.0.0.1:6080',
      ws: true,
      changeOrigin: true,
      rewrite: (path: string) =>
        path.replace(/^\/desktop(?:\/v\d+)?(?=\/|$)/, ''),
      configure(proxy) {
        proxy.on('proxyRes', (incoming) => {
          incoming.headers['cache-control'] = 'no-cache';
        });
      },
    },
    '/api': {
      target:
        process.env.PAL_BACKEND_URL ??
        env.PAL_BACKEND_URL ??
        'http://127.0.0.1:3000',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api(?=\/|$)/, ''),
      configure(proxy) {
        proxy.on('proxyRes', (incoming, _request, outgoing) => {
          incoming.on('aborted', () => outgoing.destroy());
        });
      },
    },
  };
  return {
    define: { __PAL_RELEASE_ID__: JSON.stringify(releaseId) },
    plugins: [
      pwaIcons(appleTouchIcon),
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src/pwa',
        filename: 'sw.ts',
        injectRegister: null,
        registerType: 'prompt',
        manifest: {
          name: developmentIdentity ? 'Pal Dev' : 'Pal',
          short_name: developmentIdentity ? 'Pal Dev' : 'Pal',
          description: 'Your personal assistant.',
          id: developmentIdentity ? '/pal-dev' : '/',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#ffffff',
          icons: [
            {
              src: `/icons/${iconPrefix}-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `/icons/${iconPrefix}-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html}'],
        },
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
      ...(allowedHost ? { allowedHosts: [allowedHost] } : {}),
    },
    preview: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
      ...(allowedHost ? { allowedHosts: [allowedHost] } : {}),
    },
  };
});

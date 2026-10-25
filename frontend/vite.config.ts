import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PAL_');
  const allowedHost =
    process.env.PAL_DEV_ALLOWED_HOST ?? env.PAL_DEV_ALLOWED_HOST;
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
  for (const path of [
    '/manifest.webmanifest',
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
  ])
    proxy[path] = { ...proxy['/api'], rewrite: (path: string) => path };
  return {
    define: { __PAL_RELEASE_ID__: JSON.stringify(releaseId) },
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src/pwa',
        filename: 'sw.ts',
        injectRegister: null,
        registerType: 'prompt',
        manifest: false,
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

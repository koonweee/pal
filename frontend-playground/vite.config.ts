import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PAL_');
  const proxy: Record<string, ProxyOptions> = {
    '/desktop': {
      target:
        process.env.PAL_DESKTOP_URL ??
        env.PAL_DESKTOP_URL ??
        'http://127.0.0.1:6080',
      ws: true,
      changeOrigin: true,
      // Version the whole module tree so existing browsers load patched assets.
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
          // End the browser stream when a backend shutdown aborts its response.
          incoming.on('aborted', () => outgoing.destroy());
        });
      },
    },
  };
  return {
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  };
});

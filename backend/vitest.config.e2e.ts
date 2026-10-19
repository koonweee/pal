import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, include: ['test/**/*.e2e-spec.ts'], fileParallelism: false, hookTimeout: 30000, testTimeout: 20000 } });

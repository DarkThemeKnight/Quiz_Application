import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Only ports are read here; nothing from .env is exposed to the browser bundle
  // (Vite only exposes VITE_-prefixed variables and this project defines none).
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.APP_PORT ?? '4000';
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
    preview: { host: '127.0.0.1', port: Number(env.WEB_PORT ?? 5173) },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});

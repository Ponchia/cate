// =============================================================================
// Web-client build — the SAME renderer, in a plain browser, talking to a
// persistent cate-runtime daemon over WebSocket instead of an Electron main
// process (src/web/electronApiShim.ts). Build: `npm run build:web` →
// dist-web/, served by the daemon's --web-root. Dev: `npm run dev:web`.
// =============================================================================

import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',
  define: {
    __SENTRY_DSN__: JSON.stringify(''),
  },
  resolve: {
    alias: {
      // Electron-flavored modules → browser stand-ins.
      'electron-log/renderer': resolve(__dirname, 'src/web/stubs/electronLogWeb.ts'),
      'electron-log': resolve(__dirname, 'src/web/stubs/electronLogWeb.ts'),
      '@sentry/electron/renderer': resolve(__dirname, 'src/web/stubs/sentryWeb.ts'),
      // Node Buffer for the shared RPC/locator stack.
      buffer: 'buffer/',
    },
  },
  plugins: [react()],
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    port: 5199,
  },
  build: {
    outDir: 'dist-web',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'web.html'),
      },
    },
  },
})

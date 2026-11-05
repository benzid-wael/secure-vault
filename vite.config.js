import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import {
  DEV_PORT,
  RENDERER_CSP,
  devRendererCsp,
} from './src/electron/utils/rendererCsp.js';

const require = createRequire(import.meta.url);

const root = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

/** Serve only: the dev policy, first in <head>, over the final HTML. */
const devCspMeta = () => ({
  name: 'renderer-csp-dev',
  apply: 'serve',
  transformIndexHtml: {
    order: 'post',
    // The port the server was started on (`--port` included).
    handler: (html, ctx) =>
      html.replace(
        /<head>/,
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${devRendererCsp(
          html,
          ctx.server?.config.server.port ?? DEV_PORT,
          readFileSync(resolve(root, 'index.html'), 'utf8')
        )}" />`
      ),
  },
});

const cspMeta = () => ({
  name: 'renderer-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: RENDERER_CSP },
      injectTo: 'head-prepend',
    },
  ],
});

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react(), cspMeta(), devCspMeta()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: true, // Always enable source maps for better debugging
    minify: !isDev ? 'esbuild' : false,
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
        manualChunks(id) {
          // Split vendor libraries into separate chunks
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom')
          ) {
            return 'react-vendor';
          }
          if (
            id.includes('node_modules/@mui') ||
            id.includes('node_modules/@emotion')
          ) {
            return 'ui-vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600, // Adjust limit to account for initial bundle
  },
  server: {
    port: DEV_PORT,
  },
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ['electron'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/helpers/fastKdf.js', './src/setupTests.js'],
    env: {
      // Spawned CLI processes load the same test-only KDF patch.
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        `--import ${pathToFileURL(resolve(root, 'src/__tests__/helpers/fastKdf.js')).href}`,
      ]
        .filter(Boolean)
        .join(' '),
    },
    css: true,
    // Pre-bundle the UI libraries once instead of loading MUI's icon barrel
    // (thousands of modules) separately in every component test file.
    deps: {
      optimizer: {
        client: {
          enabled: true,
          include: [
            'react',
            'react-dom',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            '@mui/material',
            '@mui/icons-material',
            '@emotion/react',
            '@emotion/styled',
          ],
        },
      },
    },
    // Integration tests spawn the CLI many times; leave room on loaded CI.
    testTimeout: 30000,
    // Setup hooks (e.g. beforeAll seeding a vault through the CLI) too.
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: [
        'text',
        'text-summary',
        'json',
        'json-summary',
        'html',
        'lcov',
      ],
      reportsDirectory: './coverage',
      clean: true,
      skipFull: false,
      reportOnFailure: true,
      // Every source file counts, the main process's included; one no test
      // loads counts at 0% (New-6).
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        '**/node_modules/**',
        '**/public/**',
        '**/build/**',
        '**/dist/**',
        '**/coverage/**',
        '**/.history/**',
        '**/*.config.{js,cjs,mjs,ts}',
        '**/src/setupTests.js',
        '**/*.d.ts',
        '**/src/index.jsx',
        '**/*/testData.js',
        '**/scripts/**',
        '**/bin/**',
        'src/__tests__/**',
        'src/**/__tests__/**',
        'src/**/*.test.{js,jsx,ts,tsx}',
      ],
      // About 2 points under the totals measured when src/electron/** came
      // in (New-6, 2026-10-23: 89.6 / 86.2 / 88.6 / 84.0); raise them as
      // coverage improves. Keep in sync with scripts/coverage-check.js.
      thresholds: {
        lines: 87,
        functions: 84,
        statements: 86,
        branches: 82,
      },
    },
  },
});

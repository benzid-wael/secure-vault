import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const root = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

// The renderer's Content-Security-Policy (GUI-ENV-RFC §6.10). Build only: in
// dev, @vitejs/plugin-react injects an inline React Refresh script that a
// strict `script-src` would block. emotion/MUI need inline styles.
// `frame-ancestors` is left out: browsers ignore it in a <meta> policy.
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

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
  plugins: [react(), cspMeta()],
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
          if (
            id.includes('node_modules/crypto-js') ||
            id.includes('node_modules/bcryptjs')
          ) {
            return 'crypto-vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600, // Adjust limit to account for initial bundle
  },
  server: {
    port: 3000,
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
      all: true,
      clean: true,
      skipFull: false,
      reportOnFailure: true,
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
        'src/electron/**',
        'src/__tests__/**',
        'src/**/__tests__/**',
        'src/**/*.test.{js,jsx,ts,tsx}',
      ],
      // Recalibrated for vitest 4: its v8 provider switched to AST-aware
      // remapping, which reports ~11 points lower than vitest 1's
      // v8-to-istanbul mapping on the same tests. Coverage did not regress —
      // the measurement got stricter. These values sit just below the current
      // accurate numbers; raise them as real test coverage improves.
      thresholds: {
        lines: 68,
        functions: 60,
        statements: 67,
        branches: 64,
      },
    },
  },
});

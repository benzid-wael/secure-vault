import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const root = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
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
      },
    },
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
    setupFiles: ['./src/setupTests.js'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'html'],
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

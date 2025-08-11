import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'build',
    assetsDir: 'static',
    rollupOptions: {
      input: {
        main: resolve(
          fileURLToPath(new URL('.', import.meta.url)),
          'index.html'
        ),
      },
    },
  },
  server: {
    port: 3000,
    open: false,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/public/**',
        '**/build/**',
        '**/.history/**',
        '**/*.config.js',
        '**/src/setupTests.js',
        '**/*.d.ts',
        '**/src/reportWebVitals.js',
        '**/*/testData.js',
        '**/scripts/**',
      ],
      all: true,
      lines: 79,
      functions: 65,
      statements: 79,
      branches: 70,
      clean: true,
      skipFull: false,
      thresholds: {
        lines: 79,
        functions: 65,
        statements: 79,
        branches: 70,
      },
      reportOnFailure: true,
    },
  },
  resolve: {
    alias: {
      '@': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src'),
    },
  },
  define: {
    global: 'globalThis',
  },
});

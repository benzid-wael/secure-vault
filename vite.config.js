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
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/public/**',
        '**/build/**',
        '**/*.config.js',
        '**/src/setupTests.js',
        '**/src/App.jsx',
        '**/src/index.jsx',
        '**/*.d.ts',
        '**/src/reportWebVitals.js',
      ],
      all: true,
      lines: 70,
      functions: 70,
      statements: 70,
      branches: 70,
      clean: true,
      skipFull: true,
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

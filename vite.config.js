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
      thresholds: {
        lines: 79,
        functions: 60,
        statements: 79,
        branches: 70,
      },
    },
  },
});
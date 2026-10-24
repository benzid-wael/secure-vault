// @vitest-environment node
// The page's clipboard channel (GUI-ENV-BREAKDOWN Task 22, New-3).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  createClipboardHandlers,
  MAX_COPY_LENGTH,
} from '../../../electron/services/ClipboardIpc.js';
import { ClipboardService } from '../../../electron/services/ClipboardService.js';

const setup = () => {
  const board = { text: '' };
  const timers = [];
  const service = new ClipboardService({
    clipboard: {
      writeText: (t) => (board.text = t),
      readText: () => board.text,
    },
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => {},
  });
  const copy = createClipboardHandlers({ clipboard: service })[
    'clipboard:copy'
  ];
  return { board, timers, copy };
};

describe('clipboard:copy', () => {
  it('copies a secret and clears it after the timeout', () => {
    const { board, timers, copy } = setup();
    expect(copy({}, 'hunter2', { sensitive: true })).toEqual({
      success: true,
      clearsInMs: 30000,
    });
    expect(board.text).toBe('hunter2');
    timers.at(-1)();
    expect(board.text).toBe('');
  });

  it('copies anything else without clearing it', () => {
    const { board, timers, copy } = setup();
    expect(copy({}, 'user@example.com')).toEqual({
      success: true,
      clearsInMs: null,
    });
    // Only an explicit `true` makes it a secret.
    expect(copy({}, 'x', { sensitive: 'yes' }).clearsInMs).toBeNull();
    expect(timers).toHaveLength(0);
    expect(board.text).toBe('x');
  });

  it.each([
    [undefined, 'Nothing to copy'],
    ['', 'Nothing to copy'],
    [42, 'Nothing to copy'],
    ['a'.repeat(MAX_COPY_LENGTH + 1), 'Too long to copy'],
  ])('refuses %#', (text, error) => {
    const { board, copy } = setup();
    expect(copy({}, text)).toEqual({ success: false, code: 'INVALID', error });
    expect(board.text).toBe('');
  });
});

// Task 22's check: the page never writes the clipboard itself; every copy
// goes through main (New-3).
describe('no page code writes navigator.clipboard', () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
  );
  const files = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : files(full);
      return /\.(jsx?|mjs)$/.test(e.name) ? [full] : [];
    });

  it('finds no navigator.clipboard outside the tests', () => {
    const offenders = files(root)
      .filter((f) => !f.endsWith('setupTests.js'))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('navigator.clipboard'))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});

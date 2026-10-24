// The page's copy helper (GUI-ENV-BREAKDOWN Task 22).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText, clearsNote } from '../../utils/clipboard';

const win = /** @type {any} */ (window);
const saved = win.electronAPI;
afterEach(() => {
  win.electronAPI = saved;
});

describe('copyText', () => {
  it('asks main to copy, saying whether it is a secret', async () => {
    const copy = vi.fn(async () => ({ success: true, clearsInMs: 30000 }));
    win.electronAPI = { copyToClipboard: copy };
    expect(await copyText('s3cret', { sensitive: true })).toEqual({
      clearsInMs: 30000,
    });
    expect(copy).toHaveBeenCalledWith('s3cret', { sensitive: true });
  });

  it('rejects when main refuses, or when there is no main', async () => {
    win.electronAPI = {
      copyToClipboard: async () => ({ success: false, error: 'Too long' }),
    };
    await expect(copyText('x', { sensitive: false })).rejects.toThrow(
      'Too long'
    );
    win.electronAPI = {};
    await expect(copyText('x', { sensitive: false })).rejects.toThrow(
      'Copying is not available'
    );
  });
});

describe('clearsNote', () => {
  it('says when a secret is cleared, and nothing otherwise', () => {
    expect(clearsNote({ clearsInMs: 30000 })).toBe(
      ' It is cleared from the clipboard in 30 s.'
    );
    expect(clearsNote({ clearsInMs: null })).toBe('');
  });
});

/** How long a copied secret stays on the clipboard (RFC §12 D6). */
export const CLIPBOARD_CLEAR_MS = 30 * 1000;

/**
 * Main-process clipboard writes (GUI-ENV-BREAKDOWN Task 12, lean): a copied
 * secret never crosses IPC, and it's cleared after `clearMs` unless the
 * clipboard no longer holds it (the user copied something else since).
 * Values are never logged.
 */
export class ClipboardService {
  #clipboard;
  #clearMs;
  #setTimer;
  #clearTimer;
  #pending = null;

  /**
   * @param {Object} options
   * @param {{writeText: (t: string) => void, readText: () => string}} options.clipboard
   *   Electron's `clipboard`.
   * @param {number} [options.clearMs]
   * @param {(fn: () => void, ms: number) => any} [options.setTimer]
   * @param {(timer: any) => void} [options.clearTimer]
   */
  constructor({
    clipboard,
    clearMs = CLIPBOARD_CLEAR_MS,
    setTimer = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    },
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    this.#clipboard = clipboard;
    this.#clearMs = clearMs;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  /**
   * @param {string} text
   * @param {{sensitive?: boolean}} [options] Only sensitive text is cleared.
   * @returns {{clearsInMs: number|null}}
   */
  copy(text, { sensitive = true } = {}) {
    if (this.#pending) this.#clearTimer(this.#pending);
    this.#pending = null;
    this.#clipboard.writeText(text);
    if (!sensitive) return { clearsInMs: null };
    this.#pending = this.#setTimer(() => {
      this.#pending = null;
      if (this.#clipboard.readText() === text) this.#clipboard.writeText('');
    }, this.#clearMs);
    return { clearsInMs: this.#clearMs };
  }
}

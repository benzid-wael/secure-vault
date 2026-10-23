/** The longest text the page may ask main to copy (a big private key fits). */
export const MAX_COPY_LENGTH = 1024 * 1024;

/**
 * The page's clipboard channel (GUI-ENV-BREAKDOWN Task 22, New-3): every
 * copy in the app goes through main's `ClipboardService`, so a secret is
 * cleared after 30 s unless the clipboard changed since, and a new copy
 * replaces a pending clear (env vault copies use the same service). The
 * page already holds these values; it says which are secrets.
 *
 * @param {Object} deps
 * @param {import('./ClipboardService.js').ClipboardService} deps.clipboard
 */
export function createClipboardHandlers({ clipboard }) {
  return {
    'clipboard:copy': (event, text, options = {}) => {
      if (typeof text !== 'string' || text === '') {
        return { success: false, code: 'INVALID', error: 'Nothing to copy' };
      }
      if (text.length > MAX_COPY_LENGTH) {
        return { success: false, code: 'INVALID', error: 'Too long to copy' };
      }
      const { clearsInMs } = clipboard.copy(text, {
        sensitive: options?.sensitive === true,
      });
      return { success: true, clearsInMs };
    },
  };
}

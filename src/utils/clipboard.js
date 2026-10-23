/**
 * Copy through main's clipboard service (GUI-ENV-BREAKDOWN Task 22): a
 * `sensitive` copy is cleared after 30 s unless the clipboard changed
 * since. The page never writes the clipboard itself.
 *
 * @param {string} text
 * @param {{sensitive: boolean}} options
 * @returns {Promise<{clearsInMs: number|null}>} Rejects when it failed.
 */
export async function copyText(text, { sensitive }) {
  const copy = /** @type {any} */ (window).electronAPI?.copyToClipboard;
  if (!copy) throw new Error('Copying is not available');
  const result = await copy(text, { sensitive });
  if (!result?.success) throw new Error(result?.error || 'Copy failed');
  return { clearsInMs: result.clearsInMs ?? null };
}

/** " It is cleared from the clipboard in 30 s." for a secret, else "". */
export const clearsNote = ({ clearsInMs }) =>
  clearsInMs
    ? ` It is cleared from the clipboard in ${Math.round(clearsInMs / 1000)} s.`
    : '';

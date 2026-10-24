/**
 * Stands in for Electron's `safeStorage` (New-24): reversible, but the
 * stored text is never the plaintext.
 */
export function fakeSafeStorage({ available = true, backend = null } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: backend ? () => backend : undefined,
    encryptString: (text) => Buffer.from(`enc:${[...text].reverse().join('')}`),
    decryptString: (buffer) => {
      const text = buffer.toString();
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext');
      return [...text.slice(4)].reverse().join('');
    },
  };
}

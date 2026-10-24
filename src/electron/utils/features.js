/**
 * Feature gates for work that merges before it's ready to release
 * (GUI-ENV-BREAKDOWN New-4). Read once at startup by the main process; the
 * renderer asks main, so a page can't turn a gate on.
 *
 * `envVaults`: the Environments UI. On in dev runs (`npm run dev:electron`,
 * `dev:main`), off in production and packaged builds. SECURE_VAULT_ENV_UI
 * overrides either way: `1` forces it on, `0` off. When off, main registers
 * none of the env vault IPC channels.
 *
 * @param {Record<string, string|undefined>} [env]
 */
export function readFeatures(env = process.env) {
  const isDev = env.ELECTRON_IS_DEV === '1' || env.NODE_ENV === 'development';
  const override = env.SECURE_VAULT_ENV_UI;
  return {
    envVaults: override === '1' || (override !== '0' && isDev),
  };
}

/**
 * IPC for the app settings (GUI-ENV-BREAKDOWN Task 23). Main owns the file;
 * the page reads and changes settings only through these channels, and a
 * change takes effect at once.
 *
 * @param {Object} deps
 * @param {import('./AppSettingsStore.js').AppSettingsStore} deps.settings
 * @param {(next: import('./AppSettingsStore.js').AppSettings,
 *   previous: import('./AppSettingsStore.js').AppSettings) => Promise<void>|void}
 *   deps.apply
 */
export function createAppSettingsHandlers({ settings, apply }) {
  return {
    'app-settings:get': async () => ({
      success: true,
      settings: await settings.get(),
      warning: settings.warning,
    }),
    'app-settings:update': async (event, patch) => {
      const previous = await settings.get();
      const result = await settings.update(patch);
      if (result.success) await apply(result.settings, previous);
      return result;
    },
  };
}

/**
 * Put settings into effect: the env vault idle timeout, and, when
 * remembering vaults is turned off, forgetting the kept list (D5).
 *
 * @param {{session: {setIdleMs: (ms: number) => void},
 *   registry: {clearRecents: () => Promise<void>}}} targets
 * @param {import('./AppSettingsStore.js').AppSettings} next
 * @param {import('./AppSettingsStore.js').AppSettings} [previous]
 */
export async function applyAppSettings({ session, registry }, next, previous) {
  session.setIdleMs(next.idleMinutes * 60 * 1000);
  if (previous?.rememberRecents && !next.rememberRecents) {
    await registry.clearRecents();
  }
}

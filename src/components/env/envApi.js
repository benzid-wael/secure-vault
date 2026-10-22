/**
 * The preload's env vault API (`window.electronAPI.envVaults`, see
 * public/preload.js), read at call time so tests can swap it.
 *
 * Every call resolves to `{ success, ... }`: a rejected IPC call (main
 * threw, or has no handler for the channel) becomes `{ success: false,
 * code: 'ERROR', error }`, so screens show it instead of an uncaught error.
 * Event subscriptions (`on*`) are passed through.
 *
 * @returns {any}
 */
export const envApi = () => {
  const raw = /** @type {any} */ (window).electronAPI.envVaults;
  return wrapped(raw);
};

const cache = new WeakMap();

function wrapped(raw) {
  if (!raw) return raw;
  let api = cache.get(raw);
  if (api) return api;
  api = {};
  for (const [name, fn] of Object.entries(raw)) {
    api[name] =
      typeof fn !== 'function' || name.startsWith('on')
        ? fn
        : async (...args) => {
            try {
              return await fn(...args);
            } catch (error) {
              return { success: false, code: 'ERROR', error: explain(error) };
            }
          };
  }
  cache.set(raw, api); // stable identity: components use it in effect deps
  return api;
}

/** In dev, Vite reloads the page but not main: say so plainly. */
function explain(error) {
  const message = String(error?.message ?? error);
  return /No handler registered/.test(message)
    ? 'The app is older than this screen: restart it (npm run dev:electron) and try again.'
    : message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

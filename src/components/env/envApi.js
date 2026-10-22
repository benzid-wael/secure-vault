/**
 * The preload's env vault API (`window.electronAPI.envVaults`, see
 * public/preload.js). Read at call time so tests can swap it.
 *
 * @returns {any}
 */
export const envApi = () => /** @type {any} */ (window).electronAPI.envVaults;

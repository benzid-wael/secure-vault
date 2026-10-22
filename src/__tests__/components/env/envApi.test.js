import { describe, it, expect, vi, afterEach } from 'vitest';
import { envApi } from '../../../components/env/envApi';

/** The preload API isn't typed; tests mock it on `window`. */
const win = /** @type {any} */ (window);
const saved = win.electronAPI;
afterEach(() => {
  win.electronAPI = saved;
});

describe('envApi', () => {
  it('turns a rejected call into an error result', async () => {
    win.electronAPI = {
      envVaults: {
        copy: vi
          .fn()
          .mockRejectedValue(
            new Error(
              "Error invoking remote method 'env:copy': Error: No handler registered for 'env:copy'"
            )
          ),
        reveal: vi
          .fn()
          .mockRejectedValue(
            new Error("Error invoking remote method 'env:reveal': Error: boom")
          ),
      },
    };
    expect(await envApi().copy('id', 'v', 'K')).toEqual({
      success: false,
      code: 'ERROR',
      error:
        'The app is older than this screen: restart it (npm run dev:electron) and try again.',
    });
    expect((await envApi().reveal()).error).toBe('boom');
  });

  it('passes results and subscriptions through, with a stable identity', async () => {
    const unsubscribe = () => {};
    const onLocked = vi.fn(() => unsubscribe);
    win.electronAPI = {
      envVaults: {
        list: vi.fn().mockResolvedValue({ success: true }),
        onLocked,
      },
    };
    expect(await envApi().list()).toEqual({ success: true });
    expect(envApi().onLocked).toBe(onLocked);
    expect(envApi()).toBe(envApi());
  });
});

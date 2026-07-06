// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

import { MountRegistry } from '../../agent/mountRegistry.js';

describe('MountRegistry', () => {
  it('requires a secureDelete function', () => {
    expect(() => new MountRegistry({})).toThrow(/secureDelete/);
  });

  it('tracks paths and reports size/list/has', () => {
    const reg = new MountRegistry({ secureDelete: () => {} });
    reg.add('/a', () => {});
    reg.add('/b', () => {});
    expect(reg.size).toBe(2);
    expect(reg.list().sort()).toEqual(['/a', '/b']);
    expect(reg.has('/a')).toBe(true);
    expect(reg.has('/z')).toBe(false);
  });

  it('stores the rebuild closure per path', () => {
    const reg = new MountRegistry({ secureDelete: () => {} });
    const rebuild = () => 'x';
    reg.add('/a', rebuild);
    expect(reg.rebuildFor('/a')).toBe(rebuild);
  });

  it('remove securely deletes one path and forgets it', () => {
    const del = vi.fn();
    const reg = new MountRegistry({ secureDelete: del });
    reg.add('/a');
    reg.add('/b');
    reg.remove('/a');
    expect(del).toHaveBeenCalledWith('/a');
    expect(reg.has('/a')).toBe(false);
    expect(reg.has('/b')).toBe(true);
  });

  it('remove of an untracked path is a no-op', () => {
    const del = vi.fn();
    const reg = new MountRegistry({ secureDelete: del });
    reg.remove('/nope');
    expect(del).not.toHaveBeenCalled();
  });

  it('wipeAll deletes every path and clears the registry', () => {
    const del = vi.fn();
    const reg = new MountRegistry({ secureDelete: del });
    reg.add('/a');
    reg.add('/b');
    reg.wipeAll();
    expect(del).toHaveBeenCalledTimes(2);
    expect(reg.size).toBe(0);
  });

  describe('file-watch wiring', () => {
    it('arms an injected watcher per mount with its rebuild closure', () => {
      const watch = vi.fn(() => () => {});
      const reg = new MountRegistry({ secureDelete: () => {}, watch });
      const rebuild = () => {};
      reg.add('/a', rebuild);
      expect(watch).toHaveBeenCalledWith('/a', rebuild);
    });

    it('re-arms the watcher when a path is re-added, stopping the old one', () => {
      const stop = vi.fn();
      const watch = vi.fn(() => stop);
      const reg = new MountRegistry({ secureDelete: () => {}, watch });
      reg.add('/a');
      reg.add('/a');
      expect(stop).toHaveBeenCalledTimes(1);
      expect(watch).toHaveBeenCalledTimes(2);
    });

    it('remove stops the watcher BEFORE securely deleting', () => {
      const order = [];
      const stop = () => order.push('stop');
      const reg = new MountRegistry({
        secureDelete: () => order.push('delete'),
        watch: () => stop,
      });
      reg.add('/a');
      reg.remove('/a');
      expect(order).toEqual(['stop', 'delete']);
    });

    it('wipeAll stops every watcher before deleting', () => {
      const stop = vi.fn();
      const del = vi.fn();
      const reg = new MountRegistry({ secureDelete: del, watch: () => stop });
      reg.add('/a');
      reg.add('/b');
      reg.wipeAll();
      expect(stop).toHaveBeenCalledTimes(2);
      expect(del).toHaveBeenCalledTimes(2);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Electron module so MenuService can be exercised in a plain Node
// (vitest) environment without a running Electron process.
const getFocusedWindow = vi.fn();
const getAllWindows = vi.fn();

vi.mock('electron', () => ({
  default: {
    Menu: {
      buildFromTemplate: vi.fn(() => ({})),
      setApplicationMenu: vi.fn(),
    },
    BrowserWindow: {
      getFocusedWindow: () => getFocusedWindow(),
      getAllWindows: () => getAllWindows(),
    },
  },
}));

const { MenuService } = await import(
  '../../../electron/services/MenuService.js'
);

function makeWindow({ destroyed = false } = {}) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  };
}

describe('MenuService.sendMenuEvent', () => {
  let service;

  beforeEach(() => {
    service = new MenuService();
    getFocusedWindow.mockReset().mockReturnValue(null);
    getAllWindows.mockReset().mockReturnValue([]);
  });

  it('sends to the tracked window when it is alive', () => {
    const win = makeWindow();
    service.setMainWindow(win);

    service.sendMenuEvent('menu-import-vault');

    expect(win.webContents.send).toHaveBeenCalledWith('menu-import-vault');
  });

  it('falls back to a live window when the tracked one was destroyed (reopen case)', () => {
    const destroyed = makeWindow({ destroyed: true });
    const reopened = makeWindow();
    service.setMainWindow(destroyed);
    getAllWindows.mockReturnValue([reopened]);

    service.sendMenuEvent('menu-import-vault');

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(reopened.webContents.send).toHaveBeenCalledWith('menu-import-vault');
  });

  it('prefers the focused window for the fallback', () => {
    const focused = makeWindow();
    const other = makeWindow();
    service.setMainWindow(null);
    getFocusedWindow.mockReturnValue(focused);
    getAllWindows.mockReturnValue([other, focused]);

    service.sendMenuEvent('menu-new-vault');

    expect(focused.webContents.send).toHaveBeenCalledWith('menu-new-vault');
    expect(other.webContents.send).not.toHaveBeenCalled();
  });

  it('does nothing when no live window exists', () => {
    service.setMainWindow(null);

    expect(() => service.sendMenuEvent('menu-lock-vault')).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Electron module so MenuService can be exercised in a plain Node
// (vitest) environment without a running Electron process.
const getFocusedWindow = vi.fn();
/** @type {import('vitest').Mock<(template: any[]) => object>} */
const buildFromTemplate = vi.fn(() => ({}));
const getAllWindows = vi.fn();

vi.mock('electron', () => ({
  default: {
    Menu: {
      buildFromTemplate: (template) => buildFromTemplate(template),
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

describe('MenuService: File → Lock Vault (New-46)', () => {
  const lockItem = () =>
    /** @type {any[]} */ (buildFromTemplate.mock.lastCall)[0]
      .find((menu) => menu.label === 'File')
      .submenu.find((item) => item.label === 'Lock Vault');

  it('locks in main first, then tells the page', () => {
    const order = [];
    const service = new MenuService({ onLock: () => order.push('main') });
    const win = makeWindow();
    win.webContents.send.mockImplementation((name) => order.push(name));
    service.createMenu(win);

    expect(lockItem().accelerator).toBe('CmdOrCtrl+L');
    lockItem().click();
    expect(order).toEqual(['main', 'menu-lock-vault']);
  });

  it('still tells the page without an onLock', () => {
    const service = new MenuService();
    const win = makeWindow();
    service.createMenu(win);
    lockItem().click();
    expect(win.webContents.send).toHaveBeenCalledWith('menu-lock-vault');
  });
});

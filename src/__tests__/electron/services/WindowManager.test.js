// @vitest-environment node
// Pins the renderer hardening (GUI-ENV-BREAKDOWN Task 1) and covers how the
// window loads and refuses navigation. The option test proves `sandbox` is
// passed; the e2e run proves Electron honored it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const created = [];
// A rejection for the next window's first load, set before it opens.
const nextLoad = vi.hoisted(() => ({ rejection: null }));
vi.mock('electron', () => {
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.onceHandlers = {};
      this.webContents = {
        handlers: {},
        on: vi.fn((event, fn) => {
          this.webContents.handlers[event] = fn;
        }),
        setWindowOpenHandler: vi.fn((fn) => {
          this.webContents.openHandler = fn;
        }),
        openDevTools: vi.fn(),
        send: vi.fn(),
      };
      this.loadURL = vi.fn(() => {
        const rejection = nextLoad.rejection;
        nextLoad.rejection = null;
        return rejection ? Promise.reject(rejection) : Promise.resolve();
      });
      this.show = vi.fn();
      this.focus = vi.fn();
      this.restore = vi.fn();
      this.isMinimized = vi.fn(() => true);
      this.destroyed = false;
      created.push(this);
    }
    once(event, fn) {
      (this.onceHandlers[event] ||= []).push(fn);
    }
    on(event, fn) {
      this.handlers[event] = fn;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  return { BrowserWindow, dialog: { showErrorBox: vi.fn() } };
});

const { WindowManager } = await import(
  '../../../electron/services/WindowManager.js'
);

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('WindowManager', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  const open = ({ dev }) => {
    process.env.NODE_ENV = dev ? 'development' : 'production';
    delete process.env.ELECTRON_IS_DEV;
    const manager = new WindowManager();
    const win = manager.createMainWindow();
    return { manager, win: /** @type {any} */ (win) };
  };

  it('creates the window sandboxed and isolated, with no node in the page', () => {
    const { win } = open({ dev: false });
    expect(win.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: false,
    });
    expect(win.options.webPreferences.preload).toMatch(/preload\.(c)?js$/);
  });

  it('loads the dev server in development and opens DevTools', async () => {
    const { win } = open({ dev: true });
    await flush();
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:3000');
    expect(win.webContents.openDevTools).toHaveBeenCalled();
    win.onceHandlers['ready-to-show'].forEach((fn) => fn());
    expect(win.show).toHaveBeenCalled();
    expect(win.restore).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('shows an error page, with a hint, when the dev server is down', async () => {
    const { win } = open({ dev: true });
    await flush();
    win.webContents.handlers['did-fail-load'](
      {},
      -102,
      'ERR_CONNECTION_REFUSED',
      'http://localhost:3000/',
      true
    );
    const page = decodeURIComponent(win.loadURL.mock.calls.at(-1)[0]);
    expect(page).toMatch(/^data:text\/html/);
    expect(page).toContain('npm run dev:electron');
  });

  // New-39: a reload during startup made the packaged app loop on its own
  // error page instead of showing the app.
  describe('when a load fails', () => {
    const failLoad = (win, ...args) =>
      win.webContents.handlers['did-fail-load']({}, ...args);

    it('ignores a load a newer navigation aborted', async () => {
      const { win } = open({ dev: true });
      await flush();
      const calls = win.loadURL.mock.calls.length;
      failLoad(win, -3, 'ERR_ABORTED', 'http://localhost:3000/', true);
      expect(win.loadURL).toHaveBeenCalledTimes(calls);
    });

    it('ignores a failed subframe', async () => {
      const { win } = open({ dev: true });
      await flush();
      const calls = win.loadURL.mock.calls.length;
      failLoad(win, -2, 'ERR_FAILED', 'http://localhost:3000/x', false);
      expect(win.loadURL).toHaveBeenCalledTimes(calls);
    });

    it('shows the error page once, not again when it fails itself', async () => {
      const { win } = open({ dev: true });
      await flush();
      failLoad(win, -2, 'ERR_FAILED', 'http://localhost:3000/', true);
      const calls = win.loadURL.mock.calls.length;
      const errorPage = win.loadURL.mock.calls.at(-1)[0];
      failLoad(win, -2, 'ERR_FAILED', errorPage, true);
      expect(win.loadURL).toHaveBeenCalledTimes(calls);
    });

    it('leaves a rejected startup load to did-fail-load', async () => {
      nextLoad.rejection = Object.assign(new Error('ERR_ABORTED (-3)'), {
        errno: -3,
        code: 'ERR_ABORTED',
      });
      const { win } = open({ dev: true });
      await flush();
      expect(win.loadURL).toHaveBeenCalledTimes(1);
      expect(win.loadURL).toHaveBeenCalledWith('http://localhost:3000');
    });

    it('still shows the error page for a startup error that is not a load', async () => {
      const { win } = open({ dev: false }); // the build is missing
      await flush();
      expect(win.loadURL.mock.calls.at(-1)[0]).toMatch(/^data:/);
    });
  });

  it('shows an error page when the production build is missing', async () => {
    // Under src/, `../index.html` doesn't exist: the not-built case.
    const { win } = open({ dev: false });
    await flush();
    const page = decodeURIComponent(win.loadURL.mock.calls.at(-1)[0]);
    expect(page).toContain('Production build not found');
  });

  it('denies new windows', () => {
    const { win } = open({ dev: false });
    expect(win.webContents.openHandler()).toEqual({ action: 'deny' });
  });

  it.each([
    [false, 'https://evil.example/', true],
    [false, 'file:///app/index.html', false],
    [true, 'http://localhost:3000/x', false],
    [true, 'https://evil.example/', true],
  ])('dev=%s: navigating to %s is prevented: %s', (dev, url, prevented) => {
    const { win } = open({ dev });
    const event = { preventDefault: vi.fn() };
    win.webContents.handlers['will-navigate'](event, url);
    expect(event.preventDefault).toHaveBeenCalledTimes(prevented ? 1 : 0);
  });

  it('sends to the window only while it exists', () => {
    const { manager, win } = open({ dev: false });
    expect(manager.getMainWindow()).toBe(win);
    manager.sendToRenderer('ping', 1);
    expect(win.webContents.send).toHaveBeenCalledWith('ping', 1);
    win.destroyed = true;
    manager.sendToRenderer('ping', 2);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    win.handlers.closed();
    expect(manager.getMainWindow()).toBeNull();
  });
});

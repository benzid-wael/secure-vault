// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { SecurityManager } from '../../../electron/services/SecurityManager.js';

function fakeWindow({ destroyed = false } = {}) {
  const mainFrame = { name: 'main' };
  const webContents = { mainFrame };
  return { webContents, isDestroyed: () => destroyed };
}

describe('SecurityManager.isTrustedSender', () => {
  const sm = new SecurityManager();

  it('accepts the main window top frame', () => {
    const win = fakeWindow();
    const event = {
      sender: win.webContents,
      senderFrame: win.webContents.mainFrame,
    };
    expect(sm.isTrustedSender(event, win)).toBe(true);
  });

  it('rejects a subframe of the main window', () => {
    const win = fakeWindow();
    const event = { sender: win.webContents, senderFrame: { name: 'iframe' } };
    expect(sm.isTrustedSender(event, win)).toBe(false);
  });

  it('rejects another webContents', () => {
    const win = fakeWindow();
    const other = fakeWindow();
    const event = {
      sender: other.webContents,
      senderFrame: other.webContents.mainFrame,
    };
    expect(sm.isTrustedSender(event, win)).toBe(false);
  });

  it('rejects when the frame is gone or the window is missing/destroyed', () => {
    const win = fakeWindow();
    expect(
      sm.isTrustedSender({ sender: win.webContents, senderFrame: null }, win)
    ).toBe(false);
    const event = {
      sender: win.webContents,
      senderFrame: win.webContents.mainFrame,
    };
    expect(sm.isTrustedSender(event, null)).toBe(false);
    const dead = fakeWindow({ destroyed: true });
    expect(
      sm.isTrustedSender(
        { sender: dead.webContents, senderFrame: dead.webContents.mainFrame },
        dead
      )
    ).toBe(false);
  });
});

describe('SecurityManager.validateVaultName', () => {
  const sm = new SecurityManager();

  it.each(['main', 'my-vault_2', 'with space'])('accepts %j', (name) => {
    expect(sm.validateVaultName(name).isValid).toBe(true);
  });

  it.each(['', '../x', 'a/b', 'a\\b', 'x'.repeat(51), undefined, 42])(
    'rejects %j',
    (name) => {
      expect(sm.validateVaultName(name).isValid).toBe(false);
    }
  );
});

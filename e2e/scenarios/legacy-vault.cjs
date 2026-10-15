// An older vault through unlock, the 600k upgrade, the session-bound API,
// export / import, manual lock, auto-lock (sleep and screen lock) and the
// IPC sender check.
const path = require('path');
const fs = require('fs');
const { BrowserWindow, powerMonitor } = require('electron');
const scenario = require('../driver.cjs');

const PW = 'Second-Pass-2@';
const ENTRY = 'Example Mail';

scenario(async (t) => {
  t.check('the vault is listed', await t.waitText('legacy'));
  await t.click('legacy');
  t.check('login opens', await t.waitText('Master Password'));
  await t.fill('Master Password', PW);
  await t.submit();
  t.check('unlock shows the entry', await t.waitText(ENTRY, 15000));
  t.check('the manager is open', await t.waitText('Lock Vault'));

  const upgraded = t.readVault('legacy');
  t.check(
    'unlock re-keys the vault to 600k',
    upgraded.kdf?.iterations === 600000,
    JSON.stringify(upgraded.kdf)
  );
  t.check(
    'legacy previous-password metadata is dropped',
    !upgraded.recoveryMetadata?.lastUsedPassword
  );
  t.check(
    'recovery-key metadata is re-keyed',
    upgraded.recoveryMetadata?.recoveryKey?.kdf?.iterations === 600000
  );

  t.check(
    'the master password is not in the page',
    !(await t.js(
      `document.documentElement.outerHTML.includes(${JSON.stringify(PW)})`
    ))
  );
  const load = await t.api("loadVault('legacy')");
  t.check('loadVault(name) works while unlocked', load.success === true);
  t.check(
    'loadVault never returns the password',
    !JSON.stringify(load).includes(PW)
  );
  const traversal = await t.api("loadVault('../legacy')");
  t.check('a traversal vault name is refused', traversal.success === false);

  const exported = await t.api("exportVault('legacy')");
  t.check(
    'export writes the file chosen in the dialog',
    exported.success && fs.existsSync(t.EXPORT_PATH),
    exported.error
  );

  await t.click('Lock Vault');
  t.check(
    'Lock Vault returns to the selector',
    (await t.waitText('legacy')) && !(await t.hasText('Lock Vault'))
  );
  const locked = await t.api("loadVault('legacy')");
  t.check(
    'the API is refused once locked',
    locked.success === false && locked.locked === true
  );

  // Auto-lock: sleep, then screen lock.
  for (const event of ['suspend', 'lock-screen']) {
    await t.api(`unlockVault('legacy', ${JSON.stringify(PW)})`);
    const open = await t.api("loadVault('legacy')");
    powerMonitor.emit(event);
    await t.sleep(500);
    const after = await t.api("loadVault('legacy')");
    t.check(
      `auto-lock on ${event} closes the session`,
      open.success === true && after.locked === true
    );
  }

  // The UI follows a main-process lock back to the selector.
  await t.click('legacy');
  await t.fill('Master Password', PW);
  await t.submit();
  await t.waitText('Lock Vault', 15000);
  powerMonitor.emit('lock-screen');
  t.check(
    'the window drops back to the selector on screen lock',
    await t.waitText('Choose a vault or create a new one')
  );

  const selected = await t.api('selectImportFile()');
  const imported = await t.api(
    `importVault('restored', ${JSON.stringify(PW)})`
  );
  t.check(
    'importing the export succeeds',
    selected.success && imported.success,
    imported.error
  );
  t.check(
    'the imported vault is written at 600k',
    t.readVault('restored').kdf?.iterations === 600000
  );
  await t.api(`unlockVault('restored', ${JSON.stringify(PW)})`);
  const restored = await t.api("loadVault('restored')");
  t.check(
    'the imported vault has the entry',
    JSON.stringify(restored.data?.entries || {}).includes(ENTRY)
  );

  const wrong = await t.api("unlockVault('legacy', 'Wrong-Pass-9!')");
  t.check('a wrong password is refused', wrong.success === false);

  // Another window with the same preload is not a trusted sender.
  const rogue = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(process.env.E2E_REPO, 'build/electron/preload.cjs'),
      contextIsolation: true,
    },
  });
  await rogue.loadURL('data:text/html,<p>rogue</p>');
  const fromRogue = await rogue.webContents.executeJavaScript(
    'window.electronAPI.getVaults()'
  );
  t.check(
    'IPC from another window is refused',
    fromRogue.success === false && /Untrusted/.test(fromRogue.error),
    fromRogue.error
  );
  rogue.destroy();
});

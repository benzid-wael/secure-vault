// A key file as second factor (GUI-ENV-BREAKDOWN New-54, steps 3-6): turned
// on in Settings, then needed with the password to unlock, read from where
// it was last used; another key file can be chosen, a wrong one is refused;
// the password and the key file are changed; turned off again. Native
// dialogs are played by the scenario. Recovery: key-file-recovery.cjs.
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const scenario = require('../driver.cjs');

const PASSWORD = 'Team-Pass-6&';
const NEW_PASSWORD = 'Team-Pass-7&';

scenario(async (t) => {
  const keyFile = path.join(t.OUT, 'keys', 'team.svkey');
  const otherKey = path.join(t.OUT, 'keys', 'other.svkey');
  const vaultFile = () =>
    JSON.parse(fs.readFileSync(path.join(t.VAULTS_DIR, 'team.vault'), 'utf8'));
  const nextKey = path.join(t.OUT, 'keys', 'next.svkey');
  let picked = keyFile;
  let saveTo = keyFile;
  let opened = 0;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: saveTo });
  dialog.showOpenDialog = async () => {
    opened += 1;
    return { canceled: false, filePaths: [picked] };
  };
  const unlockScreen = async () => {
    await t.click('team');
    await t.waitText('Master Password');
    await t.fill('Master Password', PASSWORD);
  };

  await t.waitText('team');
  await unlockScreen();
  await t.submit();
  t.check(
    'the vault unlocks with its password',
    await t.waitText('Lock Vault', 15000)
  );

  await t.click('Settings');
  t.check(
    'Settings offers a key file',
    await t.waitText('Require a Key File…')
  );
  await t.click('Require a Key File…');
  await t.waitText('Require a key file');
  await t.fill('Master Password', PASSWORD);
  await t.click('Require Key File');
  t.check(
    'the key file is turned on',
    await t.waitText('team now needs its key file (team.svkey)', 15000)
  );
  t.check('the key file is written', fs.existsSync(keyFile));
  t.check('the vault is now format 2', vaultFile().version === 2);
  t.check(
    'the session keeps working',
    (await t.api("loadVault('team')")).success === true
  );

  // Its export imports with the password and the key file (New-55).
  const exportFile = path.join(t.OUT, 'team.vault.json');
  saveTo = exportFile;
  await t.api("exportVault('team')");
  picked = exportFile;
  const chosen = await t.api('selectImportFile()');
  picked = keyFile;
  const imported = await t.api(
    `importVault('team-copy', ${JSON.stringify(PASSWORD)})`
  );
  t.check(
    'its export imports with the password and the key file',
    chosen.keyFile === true &&
      imported.success === true &&
      imported.keyFile === true &&
      fs.existsSync(path.join(t.VAULTS_DIR, 'team-copy.vault'))
  );
  saveTo = keyFile;
  opened = 0;

  await t.api('lockVault()');
  await t.reload();
  await t.waitText('team');
  await unlockScreen();
  t.check(
    'the login reads the key file from where it was last used',
    await t.waitText('it’s read from where you last used it')
  );

  fs.mkdirSync(path.dirname(otherKey), { recursive: true });
  fs.writeFileSync(
    otherKey,
    JSON.stringify({
      type: 'secure-vault-key-file',
      version: 1,
      key: Buffer.alloc(32, 9).toString('base64'),
    })
  );
  picked = otherKey;
  await t.click('Choose another key file…');
  t.check(
    'another key file can be chosen, and a wrong one is refused',
    (await t.waitText("This key file isn't the one this vault uses.", 15000)) &&
      opened === 1
  );

  await t.click('Unlock Vault');
  t.check(
    'the password and the remembered key file unlock it, no dialog',
    (await t.waitText('Lock Vault', 15000)) && opened === 1
  );

  picked = keyFile; // changes ask for the key file, in a dialog
  await t.click('Settings');
  await t.waitText('Change Master Password');
  await t.click('Change Master Password');
  t.check(
    'changing the password says the key file comes next',
    await t.waitText('This vault requires a key file')
  );
  await t.fill('Current Password', PASSWORD);
  await t.fill('New Password', NEW_PASSWORD);
  await t.fill('Confirm New Password', NEW_PASSWORD);
  await t.click('Change Password');
  t.check(
    'the password changes with the key file, the session goes on',
    (await t.waitText('Master password changed successfully', 15000)) &&
      opened === 2 &&
      (await t.api("loadVault('team')")).success === true
  );

  saveTo = nextKey;
  await t.click('Change Key File…');
  await t.waitText('Change the key file');
  await t.fill('Master Password', NEW_PASSWORD);
  await t.click('Change Key File');
  t.check(
    'the key file is replaced by a new one',
    (await t.waitText('team now uses next.svkey', 15000)) &&
      fs.existsSync(nextKey)
  );

  picked = nextKey; // turning it off asks for the key file, in a dialog
  await t.waitText('Stop Requiring a Key File…');
  await t.click('Stop Requiring a Key File…');
  await t.waitText('Stop requiring a key file');
  await t.fill('Master Password', NEW_PASSWORD);
  await t.click('Stop Requiring It');
  t.check(
    'the key file is turned off',
    await t.waitText('team no longer needs a key file.', 15000)
  );
  t.check('the vault is format 1 again', vaultFile().version === undefined);
  t.check(
    'the password alone opens it again',
    (await t.api(`unlockVault('team', ${JSON.stringify(NEW_PASSWORD)})`))
      .success === true
  );
});

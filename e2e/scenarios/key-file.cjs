// A key file as second factor (GUI-ENV-BREAKDOWN New-54, steps 3-4): turned
// on in Settings, then needed with the password to unlock, read from where
// it was last used; another key file can be chosen, a wrong one is refused;
// turned off again. Native dialogs are played by the scenario.
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const scenario = require('../driver.cjs');

const PASSWORD = 'Team-Pass-6&';

scenario(async (t) => {
  const keyFile = path.join(t.OUT, 'keys', 'team.svkey');
  const otherKey = path.join(t.OUT, 'keys', 'other.svkey');
  const vaultFile = () =>
    JSON.parse(fs.readFileSync(path.join(t.VAULTS_DIR, 'team.vault'), 'utf8'));
  let picked = keyFile;
  let opened = 0;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: keyFile });
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

  picked = keyFile; // turning it off asks for the key file, in a dialog
  await t.click('Settings');
  await t.waitText('Stop Requiring a Key File…');
  await t.click('Stop Requiring a Key File…');
  await t.waitText('Stop requiring a key file');
  await t.fill('Master Password', PASSWORD);
  await t.click('Stop Requiring It');
  t.check(
    'the key file is turned off',
    await t.waitText('team no longer needs a key file.', 15000)
  );
  t.check('the vault is format 1 again', vaultFile().version === undefined);
  t.check(
    'the password alone opens it again',
    (await t.api(`unlockVault('team', ${JSON.stringify(PASSWORD)})`))
      .success === true
  );
});

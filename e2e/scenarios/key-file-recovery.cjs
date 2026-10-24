// Recovering a vault that uses a key file (GUI-ENV-BREAKDOWN New-54, step
// 5): password and key file both lost, the recovery key alone opens it once
// a new password and a new key file are set. Native dialogs are played by
// the scenario.
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const scenario = require('../driver.cjs');

const NEW_PASSWORD = 'Fresh-Pass-34!';

scenario(async (t) => {
  const recoveryKey = fs
    .readFileSync(path.join(t.OUT, 'recovery-key.txt'), 'utf8')
    .trim();
  const newKey = path.join(t.OUT, 'usb', 'locked-out.svkey');
  fs.mkdirSync(path.dirname(newKey), { recursive: true });
  let opened = 0;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: newKey });
  dialog.showOpenDialog = async () => {
    opened += 1;
    return { canceled: true, filePaths: [] };
  };

  await t.waitText('locked-out');
  await t.click('locked-out');
  await t.waitText('Master Password');
  await t.click('Forgot your password? Use recovery options');
  await t.waitText('Recover with Recovery Key');
  t.check(
    'only the recovery key is offered',
    !(await t.hasText('Previous Password'))
  );

  await t.fill('Recovery Key', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111');
  await t.submit();
  t.check(
    'a wrong recovery key is refused',
    await t.waitText('Invalid recovery key', 15000)
  );

  await t.fill('Recovery Key', recoveryKey.toLowerCase());
  await t.submit();
  t.check(
    'the right one asks for a new password',
    await t.waitText('The recovery key is right', 15000)
  );
  t.check(
    'the vault is not open yet',
    (await t.api("loadVault('locked-out')")).success !== true
  );

  await t.fill('New Master Password', NEW_PASSWORD);
  await t.fill('Confirm New Password', NEW_PASSWORD);
  await t.click('Set Password and Open');
  t.check(
    'it opens with its entries, and a new key file is written',
    (await t.waitText('Example Bank', 15000)) && fs.existsSync(newKey)
  );
  t.check(
    'the page says what changed',
    await t.waitText('locked-out has a new password and key file')
  );
  t.check(
    'the new password never reaches the page',
    !(await t.js(
      `document.documentElement.outerHTML.includes(${JSON.stringify(NEW_PASSWORD)})`
    ))
  );

  await t.api('lockVault()');
  await t.reload();
  await t.waitText('locked-out');
  await t.click('locked-out');
  await t.waitText('Master Password');
  await t.fill('Master Password', NEW_PASSWORD);
  await t.click('Unlock Vault');
  t.check(
    'the new password and the new key file unlock it, no dialog',
    (await t.waitText('Lock Vault', 15000)) && opened === 0
  );
});

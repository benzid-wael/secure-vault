// Changing the master password from Settings: the old password stops
// working, the new one opens the vault, and no backup keeps the old key.
const fs = require('fs');
const path = require('path');
const scenario = require('../driver.cjs');

const OLD = 'Old-Pass-4$';
const NEW = 'New-Pass-5%';

scenario(async (t) => {
  await t.waitText('personal');
  await t.click('personal');
  await t.fill('Master Password', OLD);
  await t.submit();
  t.check(
    'unlock with the old password',
    await t.waitText('Lock Vault', 15000)
  );

  await t.click('Settings');
  t.check('Settings opens', await t.waitText('Change Master Password'));
  await t.click('Change Master Password');
  t.check('the dialog opens', await t.waitText('Confirm New Password'));
  await t.fill('Current Password', OLD);
  await t.fill('New Password', NEW);
  await t.fill('Confirm New Password', NEW);
  await t.click('Change Password');
  t.check(
    'Settings reports the change',
    await t.waitText('Master password changed successfully', 15000)
  );
  t.check(
    'the session keeps working with the new key',
    (await t.api("loadVault('personal')")).success === true
  );

  await t.api('lockVault()');
  const withOld = await t.api(
    `unlockVault('personal', ${JSON.stringify(OLD)})`
  );
  t.check('the old password no longer unlocks', withOld.success === false);
  const withNew = await t.api(
    `unlockVault('personal', ${JSON.stringify(NEW)})`
  );
  t.check('the new password unlocks', withNew.success === true);
  t.check(
    'no backup under the old password is left',
    !fs.existsSync(path.join(t.VAULTS_DIR, 'personal.vault.backup'))
  );
});

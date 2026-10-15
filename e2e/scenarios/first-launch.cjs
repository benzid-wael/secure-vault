// A fresh install: no vault is created for the user, and a `default` vault
// left by an earlier version (password `changeme123`) is flagged on unlock.
const scenario = require('../driver.cjs');

scenario(async (t) => {
  t.check(
    'first launch invites creating a vault',
    await t.waitText('Create your first vault to get started')
  );
  await t.sleep(1000);
  t.check(
    'no vault file is created',
    !t.vaultFiles().some((f) => f.endsWith('.vault')),
    JSON.stringify(t.vaultFiles())
  );
  const list = await t.api('getVaults()');
  t.check('the vault list is empty', list.success && list.data.length === 0);
  t.check('no default password on screen', !(await t.hasText('changeme123')));

  // A default vault from an earlier version.
  const vs = await t.vaultService();
  await vs.createVault('default', 'changeme123');
  await t.reload();
  t.check('the old default vault is listed', await t.waitText('default'));
  await t.click('default');
  t.check('login opens', await t.waitText('Master Password'));
  t.check('login shows no password hint', !(await t.hasText('changeme123')));
  await t.fill('Master Password', 'changeme123');
  await t.submit();
  t.check(
    'unlock warns about the built-in password',
    await t.waitText('built-in password', 15000)
  );
  await t.click('Change password');
  t.check(
    'the warning opens Settings',
    await t.waitText('Change Master Password')
  );

  const del = await t.api("deleteVault('default', '')");
  t.check(
    'deleting without the password is refused',
    del.success === false && t.vaultFiles().includes('default.vault'),
    del.error
  );
});

// A user who forgot the master password unlocks with the recovery key.
const fs = require('fs');
const path = require('path');
const scenario = require('../driver.cjs');

scenario(async (t) => {
  const recoveryKey = fs
    .readFileSync(path.join(t.OUT, 'recovery-key.txt'), 'utf8')
    .trim();

  await t.waitText('locked-out');
  await t.click('locked-out');
  await t.waitText('Master Password');
  await t.click('Forgot your password? Use recovery options');
  t.check('recovery opens', await t.waitText('Recover with Recovery Key'));

  await t.fill('Recovery Key', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111');
  await t.submit();
  t.check(
    'a wrong recovery key is refused',
    (await t.waitText('Invalid', 15000)) && !(await t.hasText('Lock Vault'))
  );

  await t.fill('Recovery Key', recoveryKey.toLowerCase());
  await t.submit();
  t.check(
    'the recovery key unlocks the vault',
    await t.waitText('Example Bank', 15000)
  );
  const load = await t.api("loadVault('locked-out')");
  t.check('the session is open', load.success === true);
  t.check(
    'the recovered password never reaches the page',
    !(await t.js(
      "document.documentElement.outerHTML.includes('Forgotten-Pass-3#')"
    )) && !JSON.stringify(load).includes('Forgotten-Pass-3#')
  );
});

// The password vault locks itself after the idle time (Task 13), with the
// env UI gate off: the setting is in Configuration, calls the page makes on
// its own don't keep the vault open, and the page says why it locked.
const scenario = require('../driver.cjs');

scenario(async (t) => {
  await t.waitText('personal');
  await t.js(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, metaKey: true }))"
  );
  t.check(
    'Configuration shows the app settings without the env gate',
    await t.waitText('App settings')
  );
  t.check(
    'the idle time saved earlier is shown',
    await t.hasText('1 minute without activity')
  );
  t.check(
    'no env vault setting without the gate',
    !(await t.hasText('Remember environment vaults I open'))
  );
  await t.click('Close');

  await t.click('personal');
  await t.fill('Master Password', 'Idle-Pass-6^');
  await t.submit();
  t.check('unlock', await t.waitText('Lock Vault', 15000));

  // No input from here on; a call the page makes doesn't count.
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  t.check(
    'still unlocked after 30 s',
    (await t.api("loadVault('personal')")).success === true
  );
  t.check(
    'locked about a minute after the last input, and says why',
    await t.waitText('Vault locked after 1 minute without activity.', 45_000)
  );
  t.check(
    'main holds no session',
    (await t.api("loadVault('personal')")).success === false
  );
});

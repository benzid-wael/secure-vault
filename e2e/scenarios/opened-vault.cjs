// A password vault opened from another folder (GUI-ENV-BREAKDOWN New-53):
// Open… lists it, it unlocks and saves in place, its file is shown, and
// removing it from the list leaves the file. An env vault is refused.
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const scenario = require('../driver.cjs');

const PASSWORD = 'Team-Pass-6&';

scenario(async (t) => {
  const shared = path.join(t.OUT, 'shared');
  const teamFile = path.join(shared, 'team.vault');
  let picked = path.join(shared, '.env.vault');
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [picked],
  });

  t.check('Open… is offered', await t.waitText('Open…'));
  await t.click('Open…');
  t.check(
    'an env vault is refused',
    await t.waitText(
      '.env.vault is an environment vault, not a password vault.'
    )
  );

  picked = teamFile;
  await t.click('Open…');
  t.check(
    'the vault asks for its password',
    await t.waitText('Master Password')
  );
  await t.fill('Master Password', PASSWORD);
  await t.submit();
  t.check('the vault unlocks', await t.waitText('Lock Vault', 15000));

  const before = fs.readFileSync(teamFile, 'utf8');
  const loaded = await t.api("loadVault('team')");
  const saved = await t.api(
    `saveVault('team', ${JSON.stringify(loaded.data)})`
  );
  t.check('a save succeeds', saved.success === true, saved.error);
  t.check(
    'it is written in place',
    fs.readFileSync(teamFile, 'utf8') !== before &&
      !fs.existsSync(path.join(t.VAULTS_DIR, 'team.vault'))
  );

  await t.click('Lock Vault');
  t.check('the list shows where it lives', await t.waitText(teamFile));
  t.check(
    'the list is kept for the next run',
    fs.existsSync(
      path.join(path.dirname(t.VAULTS_DIR), 'gui-opened-vaults.json')
    )
  );

  await t.clickLabel('Remove team from the list');
  t.check(
    'removal says where the file stays',
    await t.waitText(
      `Removed team from the list. Its file stays at ${teamFile}.`
    )
  );
  await t.sleep(500);
  // The message above names the file, so look for the card itself.
  t.check(
    'it is off the list',
    (await t.js(
      `document.querySelector('[aria-label="Remove team from the list"]')`
    )) === null
  );
  t.check('its file is untouched', fs.existsSync(teamFile));
});

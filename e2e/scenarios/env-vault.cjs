// The Environments UI end to end (GUI-ENV-BREAKDOWN Tasks 1, 2, 14–21 MVP):
// unlock a seeded env vault, see secrets masked, reveal and edit one, lose
// no write to a concurrent CLI-style edit (reload, merge, conflict), lock, and
// create a new vault with an env and a variable. Plus the M0 checks: the
// renderer is sandboxed and the CSP blocks inline scripts.
process.env.SECURE_VAULT_ENV_UI = '1';
const fs = require('fs');
const path = require('path');
const scenario = require('../driver.cjs');

const PASSWORD = 'Env-Pass-7&';
const SECRET = 'sk-seeded-secret-123';

scenario(async (t) => {
  const { EnvironmentVaultService: EVS } = await import(
    path.join(
      process.env.E2E_REPO,
      'src/electron/services/EnvironmentVaultService.js'
    )
  );
  const vaultPath = path.join(t.ENVS_DIR, 'app.env.vault');
  const activeVars = async (env) => {
    const read = await EVS.read(vaultPath, PASSWORD);
    return read.vault.getActiveVersion(env).vars;
  };

  // M0
  t.check('the renderer is sandboxed', (await t.sandboxed()) === true);
  const inline = await t.js(`(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true';
    document.head.appendChild(s);
    return window.__inlineRan === true;
  })()`);
  t.check('the CSP blocks an injected inline script', inline === false);
  t.check(
    'no CSP violation besides the injected script',
    t.cspViolations.length === 1,
    t.cspViolations.length === 1 ? '' : JSON.stringify(t.cspViolations)
  );

  // Open and unlock
  t.check(
    'the switch is shown with the gate on',
    await t.waitText('Environments')
  );
  await t.click('Environments');
  t.check('the seeded vault is listed', await t.waitText('Environment Vaults'));
  await t.sleep(300);
  await t.click('app');
  t.check('unlock asks for the password', await t.waitText('Vault Password'));
  await t.fill('Vault Password', 'wrong-password');
  await t.submit();
  t.check(
    'a wrong password is refused',
    await t.waitText('Wrong password for app.env.vault', 15000)
  );
  await t.fill('Vault Password', PASSWORD);
  await t.submit();
  t.check('the vault opens', await t.waitText('New environment', 15000));
  await t.click('prod');
  t.check('prod shows its key', await t.waitText('API_KEY'));
  t.check('the inherited key is shown', await t.waitText('from base'));
  t.check('a public inherited value is shown', await t.hasText('debug'));
  t.check('the secret is masked', !(await t.hasText(SECRET)));

  const ids = await t.js(
    `window.electronAPI.envVaults.list().then((r) => r.vaults.map((v) => v.id))`
  );
  const view = await t.api(`envVaults.view(${JSON.stringify(ids[0])}, 'prod')`);
  const apiKeyRow = view.vars.find((v) => v.key === 'API_KEY');
  t.check(
    'the view response carries no secret',
    apiKeyRow && !('value' in apiKeyRow)
  );
  const forged = await t.api(`envVaults.view('0123456789abcdef', 'prod')`);
  t.check('a forged id is refused', forged.code === 'INVALID');
  // That `view` call replaced the page's view of prod; show it again.
  await t.click('base');
  await t.sleep(300);
  await t.click('prod');
  await t.waitText('API_KEY');

  // Reveal and edit
  await t.clickLabel('Reveal API_KEY');
  t.check('reveal shows the secret', await t.waitText(SECRET));
  await t.clickLabel('Edit API_KEY');
  t.check('edit opens with the value', await t.waitText('Edit API_KEY'));
  await t.fill('Value', 'sk-edited-in-gui');
  await t.click('Save');
  await t.sleep(1500);
  t.check(
    'the edit is written to the file',
    (await activeVars('prod')).API_KEY === 'sk-edited-in-gui'
  );
  t.check(
    'the new value is masked again',
    !(await t.hasText('sk-edited-in-gui'))
  );

  // Another tool writes: the app notices on its own (Task 16).
  const cli = await EVS.setEnv(
    vaultPath,
    PASSWORD,
    'prod',
    'FROM_CLI',
    'cli-value'
  );
  t.check('the CLI-style write succeeds', cli.success === true, cli.error);
  t.check(
    'the app reloads after an outside change',
    (await t.waitText('Updated with a change made outside the app.', 10000)) &&
      (await t.waitText('FROM_CLI'))
  );

  // A write elsewhere during an edit: warned, then merged on save (Task 10).
  await t.clickLabel('Edit API_KEY');
  await t.waitText('Edit API_KEY');
  await EVS.setEnv(vaultPath, PASSWORD, 'prod', 'FROM_CLI', 'cli-value-2');
  t.check(
    'an open edit is warned, not reloaded',
    await t.waitText('changed elsewhere', 10000)
  );
  await t.fill('Value', 'sk-merged');
  await t.click('Save');
  t.check(
    'the save merges with the other write',
    await t.waitText('Saved, merged with a change made elsewhere.', 10000)
  );
  let after = await activeVars('prod');
  t.check(
    'both writes are kept',
    after.API_KEY === 'sk-merged' && after.FROM_CLI === 'cli-value-2',
    JSON.stringify(after)
  );

  // The same key written elsewhere: a conflict, then the user's choice.
  await t.clickLabel('Edit API_KEY');
  await t.waitText('Edit API_KEY');
  await EVS.setEnv(vaultPath, PASSWORD, 'prod', 'API_KEY', 'sk-from-cli');
  await t.fill('Value', 'sk-second-edit');
  await t.click('Save');
  t.check(
    'a conflicting save is refused and names the key',
    await t.waitText('Changed elsewhere meanwhile: API_KEY', 10000)
  );
  t.check(
    'nothing was overwritten',
    (await activeVars('prod')).API_KEY === 'sk-from-cli'
  );
  await t.click('Overwrite');
  await t.sleep(1500);
  after = await activeVars('prod');
  t.check(
    'overwrite keeps the edit',
    after.API_KEY === 'sk-second-edit' && after.FROM_CLI === 'cli-value-2',
    JSON.stringify(after)
  );
  await t.sleep(800);

  // Copy, export and move: values go through main, never the page.
  await t.clickLabel('Copy API_KEY');
  t.check(
    'copy reports the clipboard timeout',
    await t.waitText('Copied API_KEY. It is cleared')
  );
  t.check(
    'the value is on the clipboard',
    t.clipboardText() === 'sk-second-edit'
  );
  await t.click('Export .env');
  t.check('export reports the file', await t.waitText('Exported prod to'));
  const exported = fs.readFileSync(t.EXPORT_PATH, 'utf8');
  t.check(
    'the export holds resolved values',
    exported.includes('API_KEY=sk-second-edit') &&
      exported.includes('LOG_LEVEL=debug')
  );
  t.check(
    'the export is private (0600)',
    process.platform === 'win32' ||
      (fs.statSync(t.EXPORT_PATH).mode & 0o777) === 0o600
  );
  await t.clickLabel('More actions for FROM_CLI');
  await t.click('Move to environment…');
  await t.waitText('To environment');
  await t.click('Move');
  t.check('move reports success', await t.waitText('Moved FROM_CLI to base.'));
  t.check(
    'the key moved in the file',
    (await activeVars('base')).FROM_CLI === 'cli-value-2' &&
      !('FROM_CLI' in (await activeVars('prod')))
  );

  // Lock
  await t.click('Lock');
  t.check('lock returns to the list', await t.waitText('Environment Vaults'));
  const lockedReveal = await t.api(
    `envVaults.listEnvs(${JSON.stringify(ids[0])})`
  );
  t.check('a locked vault refuses reads', lockedReveal.code === 'LOCKED');

  // A new vault, env and variable
  await t.click('New…');
  await t.waitText('New environment vault');
  await t.fill('Vault Name', 'fresh');
  await t.fill('Vault Password', PASSWORD);
  await t.fill('Confirm Password', PASSWORD);
  await t.submit();
  t.check(
    'the new vault opens',
    await t.waitText('no environments yet', 15000)
  );
  await t.click('New environment');
  await t.fill('Environment Name', 'dev');
  await t.submit();
  t.check('the env is created', await t.waitText('No variables yet', 10000));
  await t.click('Add variable');
  await t.fill('Key', 'DATABASE_URL');
  await t.fill('Value', 'postgres://localhost/dev');
  await t.click('Save');
  await t.sleep(1500);
  const fresh = await EVS.read(
    path.join(t.ENVS_DIR, 'fresh.env.vault'),
    PASSWORD
  );
  t.check(
    'the new vault holds the variable',
    fresh.success &&
      fresh.vault.getActiveVersion('dev').vars.DATABASE_URL ===
        'postgres://localhost/dev'
  );
});

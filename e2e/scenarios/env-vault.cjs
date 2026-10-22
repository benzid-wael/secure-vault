// The Environments UI end to end (GUI-ENV-BREAKDOWN Tasks 1, 2, 14–21 MVP):
// unlock a seeded env vault, see secrets masked, reveal and edit one, lose
// no write to a concurrent CLI-style edit (STALE, reload, save), lock, and
// create a new vault with an env and a variable. Plus the M0 checks: the
// renderer is sandboxed and the CSP blocks inline scripts.
process.env.SECURE_VAULT_ENV_UI = '1';
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
    await t.waitText('wrong password', 15000)
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

  // A concurrent write from another tool: the GUI must not overwrite it.
  // Reveal first, so the edit below starts from the shown value and the
  // refusal comes from the save itself.
  await t.clickLabel('Reveal API_KEY');
  await t.waitText('sk-edited-in-gui');
  const cli = await EVS.setEnv(
    vaultPath,
    PASSWORD,
    'prod',
    'FROM_CLI',
    'cli-value'
  );
  t.check('the CLI-style write succeeds', cli.success === true, cli.error);
  await t.clickLabel('Edit API_KEY');
  await t.waitText('Edit API_KEY');
  await t.fill('Value', 'sk-second-edit');
  await t.click('Save');
  t.check(
    'the stale save is refused',
    await t.waitText('changed elsewhere', 10000)
  );
  t.check(
    'nothing was overwritten',
    (await activeVars('prod')).FROM_CLI === 'cli-value' &&
      (await activeVars('prod')).API_KEY === 'sk-edited-in-gui'
  );
  await t.click('Reload');
  await t.sleep(800);
  await t.click('Save');
  await t.sleep(500);
  await t.sleep(1500);
  const after = await activeVars('prod');
  t.check(
    'after reload the edit saves and keeps the CLI write',
    after.API_KEY === 'sk-second-edit' && after.FROM_CLI === 'cli-value',
    JSON.stringify(after)
  );
  t.check('the CLI key shows up', await t.waitText('FROM_CLI'));

  // Revealing after another tool wrote is refused too, until a reload.
  await EVS.setEnv(vaultPath, PASSWORD, 'prod', 'FROM_CLI', 'cli-value-2');
  await t.clickLabel('Reveal API_KEY');
  t.check(
    'a reveal of a changed vault asks for a reload',
    (await t.waitText('changed elsewhere', 10000)) &&
      !(await t.hasText('sk-second-edit'))
  );
  await t.click('Reload');
  await t.sleep(800);
  t.check('reload clears the warning', !(await t.hasText('changed elsewhere')));

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

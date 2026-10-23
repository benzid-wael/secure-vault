// RFC goal 7 end to end (GUI-ENV-BREAKDOWN Task 29): the app and the real
// CLI edit one env vault at once. The CLI runs as a user would, with the
// same HOME and the vault by name, so both resolve the same app data. The
// app notices the CLI's write, merges a disjoint save, refuses an
// overlapping one without writing, and refuses to recreate a deleted env.
process.env.SECURE_VAULT_ENV_UI = '1';
const { spawn } = require('child_process');
const path = require('path');
const scenario = require('../driver.cjs');

const PASSWORD = 'Env-Pass-7&';
const CLI = path.join(process.env.E2E_REPO, 'bin/cli.js');

/** Runs `secure-vault env <args> -n app` and resolves to its exit. */
const cli = (...args) =>
  new Promise((resolve) => {
    // Async: the app's main process must keep running while the CLI waits
    // on the vault's lock.
    const child = spawn(
      process.env.E2E_NODE,
      [CLI, 'env', ...args, '-n', 'app'],
      {
        cwd: process.env.E2E_OUT,
        env: { ...process.env, VAULT_ENV_PASSWORD: PASSWORD, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (status) => resolve({ status, output: output.trim() }));
  });

scenario(async (t) => {
  const { EnvironmentVaultService: EVS } = await import(
    path.join(
      process.env.E2E_REPO,
      'src/electron/services/EnvironmentVaultService.js'
    )
  );
  const vaultPath = path.join(t.ENVS_DIR, 'app.env.vault');
  const prodVars = async () => {
    const read = await EVS.read(vaultPath, PASSWORD);
    return read.vault.listEnvironmentNames().includes('prod')
      ? read.vault.getActiveVersion('prod').vars
      : null;
  };
  const draft = () => t.js(`document.getElementById('env-bulk-text').value`);
  const openBulkEdit = async () => {
    await t.click('Edit as .env');
    for (let i = 0; i < 50 && !(await draft())?.includes('API_KEY='); i += 1) {
      await t.sleep(100);
    }
  };
  const expectCli = (name, r) => t.check(name, r.status === 0, r.output);

  // Seed → open → unlock
  await t.click('Environments');
  t.check('the seeded vault is listed', await t.waitText('Environment Vaults'));
  await t.sleep(300);
  await t.click('app');
  await t.waitText('Vault Password');
  await t.fill('Vault Password', PASSWORD);
  await t.submit();
  t.check('the vault opens', await t.waitText('New environment', 15000));
  await t.click('prod');
  t.check('prod shows its keys', await t.waitText('DB_URL'));

  // CLI set → the app reloads on its own
  expectCli(
    'the CLI sets a key in the vault the app has open',
    await cli('set', 'FROM_CLI', 'one', '-e', 'prod', '--public')
  );
  t.check(
    'the app shows the CLI write',
    (await t.waitText('Updated with a change made outside the app.', 10000)) &&
      (await t.waitText('FROM_CLI'))
  );

  // A disjoint CLI write during an edit: the save is rebased
  await openBulkEdit();
  t.check(
    'the draft holds the CLI write',
    (await draft()).includes('FROM_CLI=one')
  );
  expectCli(
    'the CLI writes another key during the edit',
    await cli('set', 'OTHER', 'cli', '-e', 'prod')
  );
  await t.fill('.env', `${await draft()}\nFROM_GUI=gui\n`);
  await t.click('Save');
  t.check(
    'the save is merged',
    await t.waitText('merged with a change made elsewhere', 10000)
  );
  let vars = await prodVars();
  t.check(
    'both writes are in the file',
    vars.FROM_GUI === 'gui' &&
      vars.OTHER === 'cli' &&
      vars.API_KEY === 'sk-seeded',
    JSON.stringify(Object.keys(vars))
  );

  // An overlapping CLI write: a conflict, nothing written, then overwrite
  await openBulkEdit();
  await t.fill(
    '.env',
    (await draft()).replace('DB_URL=postgres://seed', 'DB_URL=postgres://gui')
  );
  expectCli(
    'the CLI removes the key the draft changes',
    await cli('rm', 'DB_URL', '-e', 'prod')
  );
  // The watcher reloads the page; the open dialog keeps its draft.
  await t.sleep(1500);
  await t.click('Save');
  t.check(
    'the save is refused and names the key',
    (await t.waitText('Changed elsewhere since you opened it', 10000)) &&
      (await t.js(`(document.querySelector('[data-testid="conflict-DB_URL"]')
        ?.textContent ?? '').includes('removed')`))
  );
  t.check(
    'nothing was written',
    !('DB_URL' in (await prodVars())) && (await prodVars()).FROM_GUI === 'gui'
  );
  await t.click('Overwrite');
  await t.sleep(1500);
  vars = await prodVars();
  t.check(
    'overwrite writes the draft',
    vars.DB_URL === 'postgres://gui' && vars.OTHER === 'cli',
    JSON.stringify(Object.keys(vars))
  );

  // The env deleted by the CLI during a one-key edit: no overwrite
  await t.sleep(800);
  await t.clickLabel('Edit API_KEY');
  t.check('a one-key edit opens', await t.waitText('Edit API_KEY'));
  expectCli(
    'the CLI deletes the env during the edit',
    await cli('delete', 'prod')
  );
  t.check(
    'the open edit is warned',
    await t.waitText('changed elsewhere', 10000)
  );
  await t.fill('Value', 'sk-too-late');
  await t.click('Save');
  t.check(
    'the save is refused: the env is gone',
    await t.waitText('prod was deleted elsewhere', 10000)
  );
  t.check(
    'no overwrite is offered',
    !(await t.js(
      `[...document.querySelectorAll('button')].some((b) => b.textContent === 'Overwrite')`
    ))
  );
  t.check('the env stays deleted', (await prodVars()) === null);
});

import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import password from '@inquirer/password';

import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';

function clipboardWrite(text) {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? 'pbcopy' : platform === 'win32' ? 'clip' : 'xclip';
  const args = platform === 'linux' ? ['-selection', 'clipboard'] : [];

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe' });
    proc.on('error', () => reject(new Error('Clipboard not available')));
    proc.on('close', resolve);
    proc.stdin.end(text);
  });
}

async function copyToClipboard(text, label) {
  try {
    await clipboardWrite(text);
    console.log(chalk.gray(`  Copied ${label} to clipboard`));
  } catch {
    console.log(chalk.yellow('  Clipboard not available on this system'));
  }
}

function parseEnvOption(val) {
  const entries = {};
  for (const pair of val.split(',')) {
    const [envName, filePath] = pair.split('=');
    if (!envName || !filePath) {
      throw new Error(
        `Invalid --env format: "${pair}". Expected envName=filePath`
      );
    }
    entries[envName.trim()] = filePath.trim();
  }
  return entries;
}

async function getPassword(provided, promptMessage) {
  if (provided) return provided;
  return password({ message: promptMessage, mask: true });
}

async function resolveVaultPath(options) {
  const vaultPath = EnvironmentVaultService.resolveVaultPath({
    vault: options.vault,
    name: options.name,
  });

  if (!vaultPath) {
    const cwdName = process
      .cwd()
      .split(/[/\\]/)
      .pop()
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    console.log(chalk.red('No vault found.'));
    console.log(
      chalk.yellow(`  Create one:  vault env init --name ${cwdName}`)
    );
    console.log(chalk.yellow(`  Specify:     --vault <path> or --name <name>`));
    process.exit(1);
  }

  return vaultPath;
}

async function loadVault(options) {
  const vaultPassword = await getPassword(
    options.password,
    'Enter vault password:'
  );
  const vaultPath = await resolveVaultPath(options);
  const result = await EnvironmentVaultService.loadVault(
    vaultPath,
    vaultPassword
  );

  if (!result.success) {
    console.log(chalk.red(result.error));
    process.exit(1);
  }

  return { vaultPath, vaultPassword, vault: result.data };
}

export function registerEnvCommand(program) {
  const env = program.command('env').description('Manage environment vaults');

  env
    .command('init')
    .description('Initialize a new environment vault')
    .option('-n, --name <name>', 'Vault name (defaults to CWD directory name)')
    .option('-v, --vault <path>', 'Exact path for the vault file')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option(
      '-e, --env <pairs>',
      'Import .env files: envName=path,envName2=path2',
      parseEnvOption
    )
    .action(async (options) => {
      const spinner = ora('Initializing environment vault...').start();

      try {
        const vaultPassword = await getPassword(
          options.password,
          'Enter vault password:'
        );
        const confirmPassword = options.password
          ? vaultPassword
          : await password({ message: 'Confirm vault password:', mask: true });

        if (vaultPassword !== confirmPassword) {
          spinner.fail(chalk.red('Passwords do not match.'));
          process.exit(1);
        }

        const result = await EnvironmentVaultService.init({
          name: options.name,
          vault: options.vault,
          password: vaultPassword,
          environments: options.env || {},
        });

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(
          chalk.green(`Environment vault created at ${result.path}`)
        );
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('import')
    .description('Import .env files into an existing vault')
    .argument('<envName>', 'Environment name (e.g. staging, production)')
    .argument('[files...]', 'One or more .env files to import')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (envName, files, options) => {
      const spinner = ora('Importing .env files...').start();

      try {
        const vaultPassword = await getPassword(
          options.password,
          'Enter vault password:'
        );
        const vaultPath = await resolveVaultPath(options);

        if (!files || files.length === 0) {
          spinner.fail(chalk.red('No .env files specified.'));
          process.exit(1);
        }

        for (const file of files) {
          spinner.text = `Importing ${file} as "${envName}"...`;

          const result = await EnvironmentVaultService.importEnvFile(
            vaultPath,
            vaultPassword,
            envName,
            file
          );

          if (!result.success) {
            spinner.fail(chalk.red(`${file}: ${result.error}`));
            process.exit(1);
          }
        }

        spinner.succeed(
          chalk.green(`Imported ${files.length} file(s) into "${envName}".`)
        );
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('set')
    .description('Set an environment variable')
    .argument('<key>', 'Variable name')
    .argument('<value>', 'Variable value')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('-e, --env <name>', 'Environment name (defaults to "default")')
    .option('--public', 'Mark variable as non-sensitive')
    .option('-m, --message <text>', 'Version message')
    .action(async (key, value, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const envName = options.env || 'default';

        const spinner = ora(`Setting ${key}...`).start();

        const result = await EnvironmentVaultService.setEnv(
          vaultPath,
          vaultPassword,
          envName,
          key,
          value,
          { isPublic: !!options.public, message: options.message }
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Set ${key} in "${envName}".`));
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('get')
    .description('Get an environment variable')
    .argument('<key>', 'Variable name')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('-e, --env <name>', 'Environment name (defaults to "default")')
    .option('--pair', 'Output as KEY=VALUE')
    .option('--clip', 'Copy value to clipboard')
    .action(async (key, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const envName = options.env || 'default';

        const result = await EnvironmentVaultService.getEnv(
          vaultPath,
          vaultPassword,
          envName,
          key
        );

        if (!result.success) {
          console.log(chalk.red(result.error));
          process.exit(1);
        }

        if (options.pair) {
          const pair = `${key}=${result.data.value}`;
          console.log(pair);
          if (options.clip) await copyToClipboard(pair, 'pair');
        } else if (options.clip) {
          await copyToClipboard(result.data.value, 'value');
        } else {
          console.log(result.data.value);
        }
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('show')
    .description('Show environment details and all variables')
    .argument('[envName]', 'Environment name (defaults to "default")')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (envName, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const name = envName || 'default';

        const result = await EnvironmentVaultService.showEnv(
          vaultPath,
          vaultPassword,
          name
        );

        if (!result.success) {
          console.log(chalk.red(result.error));
          process.exit(1);
        }

        const { data } = result;
        console.log(chalk.bold(`\nEnvironment: ${data.name}`));
        console.log(
          chalk.gray(
            `  Active version: v${data.activeVersion} of ${data.totalVersions}`
          )
        );
        console.log(chalk.gray(`  Variables: ${data.keyCount}\n`));

        for (const k of data.keys) {
          const icon = k.sensitive ? chalk.red('🔒') : chalk.green('🔓');
          const display = k.sensitive ? chalk.gray('***') : k.value;
          console.log(`  ${icon} ${chalk.cyan(k.key)} = ${display}`);
        }

        console.log();
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('list')
    .description('List all environments in the vault')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const result = await EnvironmentVaultService.listEnvs(
          vaultPath,
          vaultPassword
        );

        if (!result.success) {
          console.log(chalk.red(result.error));
          process.exit(1);
        }

        if (result.data.length === 0) {
          console.log(chalk.yellow('\n  No environments in this vault.\n'));
          return;
        }

        console.log(chalk.bold(`\nEnvironments (${result.data.length}):\n`));
        for (const env of result.data) {
          console.log(
            `  ${chalk.cyan(env.name)}` +
              `  (v${env.activeVersion}, ${env.keyCount} keys, ${env.versionCount} versions)`
          );
        }
        console.log();
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('rm')
    .description('Remove a variable from an environment')
    .argument('<key>', 'Variable name to remove')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('-e, --env <name>', 'Environment name (defaults to "default")')
    .action(async (key, options) => {
      const spinner = ora(`Removing ${key}...`).start();

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const envName = options.env || 'default';

        const result = await EnvironmentVaultService.removeKey(
          vaultPath,
          vaultPassword,
          envName,
          key
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Removed ${key} from "${envName}".`));
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('export')
    .description('Export an environment as dotenv or JSON')
    .argument('[envName]', 'Environment name (defaults to "default")')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option(
      '-f, --format <format>',
      'Output format: dotenv (default) or json',
      'dotenv'
    )
    .option('--clip', 'Copy output to clipboard')
    .action(async (envName, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const name = envName || 'default';

        const result = await EnvironmentVaultService.exportEnv(
          vaultPath,
          vaultPassword,
          name,
          options.format
        );

        if (!result.success) {
          console.log(chalk.red(result.error));
          process.exit(1);
        }

        if (options.clip) {
          const text =
            typeof result.data === 'string'
              ? result.data
              : JSON.stringify(result.data, null, 2);
          await copyToClipboard(text, 'export');
          console.log(text);
        } else {
          console.log(result.data);
        }
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('delete')
    .description('Delete an entire environment')
    .argument('<envName>', 'Environment name to delete')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (envName, options) => {
      const spinner = ora(`Deleting environment "${envName}"...`).start();

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const result = await EnvironmentVaultService.deleteEnv(
          vaultPath,
          vaultPassword,
          envName
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Deleted environment "${envName}".`));
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('rename')
    .description('Rename an environment')
    .argument('<oldName>', 'Current environment name')
    .argument('<newName>', 'New environment name')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (oldName, newName, options) => {
      const spinner = ora(`Renaming "${oldName}" to "${newName}"...`).start();

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const result = await EnvironmentVaultService.renameEnv(
          vaultPath,
          vaultPassword,
          oldName,
          newName
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Renamed "${oldName}" to "${newName}".`));
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('template')
    .description('Generate a .env.template from an environment')
    .argument('[envName]', 'Environment name (defaults to "default")')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--clip', 'Copy template to clipboard')
    .action(async (envName, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const name = envName || 'default';

        const result = await EnvironmentVaultService.templateEnv(
          vaultPath,
          vaultPassword,
          name
        );

        if (!result.success) {
          console.log(chalk.red(result.error));
          process.exit(1);
        }

        console.log(result.data);
        if (options.clip) await copyToClipboard(result.data, 'template');
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('history')
    .description('Show version history for an environment')
    .argument('[envName]', 'Environment name (defaults to "default")')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (envName, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const name = envName || 'default';

        const result = await EnvironmentVaultService.getHistory(
          vaultPath,
          vaultPassword,
          name
        );

        if (!result.success) {
          console.log(chalk.red(result.error));
          process.exit(1);
        }

        if (result.data.length === 0) {
          console.log(chalk.yellow('\n  No history for this environment.\n'));
          return;
        }

        console.log(
          chalk.bold(
            `\nHistory for "${name}" (${result.data.length} versions):\n`
          )
        );

        for (const v of result.data) {
          const active = v.active ? chalk.green(' (active)') : '';
          const msg = v.message ? ` - ${v.message}` : '';
          console.log(`  v${v.n}${active}${chalk.gray(msg)}`);
          for (const [key, val] of Object.entries(v.vars)) {
            const icon = v.nonSensitive?.includes(key) ? '🔓' : '🔒';
            console.log(`    ${icon} ${chalk.cyan(key)}=${val}`);
          }
          console.log();
        }
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('rollback')
    .description('Rollback to a previous version')
    .argument('<versionN>', 'Version number to rollback to', Number)
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('-e, --env <name>', 'Environment name (defaults to "default")')
    .action(async (versionN, options) => {
      const spinner = ora(`Rolling back to v${versionN}...`).start();

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const envName = options.env || 'default';

        const result = await EnvironmentVaultService.rollbackEnv(
          vaultPath,
          vaultPassword,
          envName,
          versionN
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(
          chalk.green(`Rolled back "${envName}" to v${versionN}.`)
        );
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('squash')
    .description('Squash version history')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('-e, --env <name>', 'Environment name (defaults to "default")')
    .option('-k, --keep <count>', 'Number of versions to keep', Number, 1)
    .action(async (options) => {
      const spinner = ora(
        `Squashing history (keeping ${options.keep})...`
      ).start();

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const envName = options.env || 'default';

        const result = await EnvironmentVaultService.squashEnv(
          vaultPath,
          vaultPassword,
          envName,
          options.keep
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(
          chalk.green(
            `Squashed "${envName}" history to ${options.keep} version(s).`
          )
        );
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('diff')
    .description('Diff two environments')
    .argument('<envA>', 'First environment')
    .argument('<envB>', 'Second environment')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (envA, envB, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const result = await EnvironmentVaultService.diffEnvs(
          vaultPath,
          vaultPassword,
          envA,
          envB
        );

        if (!result.success) {
          console.log(chalk.red(result.error));
          process.exit(1);
        }

        const { data } = result;

        console.log(chalk.bold(`\nDiff: ${envA} → ${envB}\n`));

        if (data.added.length > 0) {
          console.log(chalk.green('  Added:'));
          for (const k of data.added) console.log(`    + ${chalk.cyan(k)}`);
        }
        if (data.removed.length > 0) {
          console.log(chalk.red('  Removed:'));
          for (const k of data.removed) console.log(`    - ${chalk.cyan(k)}`);
        }
        if (data.changed.length > 0) {
          console.log(chalk.yellow('  Changed:'));
          for (const k of data.changed) console.log(`    ~ ${chalk.cyan(k)}`);
        }
        if (data.unchanged.length > 0) {
          console.log(
            chalk.gray(`  Unchanged: ${data.unchanged.length} key(s)`)
          );
        }

        console.log();
      } catch (error) {
        console.log(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('change-password')
    .description('Change the vault password')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Current vault password (non-interactive)')
    .action(async (options) => {
      const spinner = ora('Changing vault password...').start();

      try {
        const vaultPath = await resolveVaultPath(options);
        const currentPassword = await getPassword(
          options.password,
          'Enter current password:'
        );
        const newPassword = await password({
          message: 'Enter new password:',
          mask: true,
        });
        const confirmPassword = await password({
          message: 'Confirm new password:',
          mask: true,
        });

        if (newPassword !== confirmPassword) {
          spinner.fail(chalk.red('Passwords do not match.'));
          process.exit(1);
        }

        const result = await EnvironmentVaultService.changePassword(
          vaultPath,
          currentPassword,
          newPassword
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(chalk.green('Vault password changed.'));
      } catch (error) {
        spinner.fail(chalk.red(error.message));
        process.exit(1);
      }
    });

  return env;
}

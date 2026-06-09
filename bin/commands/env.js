import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import password from '@inquirer/password';

import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../src/electron/models/EnvironmentVault.js';
import {
  INJECT_MODES,
  buildChildEnv,
  toDotenv,
  parseAllowlist,
  secureDelete,
} from './envRunHelpers.js';
import {
  buildEditorTemplate,
  parseEditorContent,
  openInEditor,
} from './envEditHelpers.js';
// Password-resolution helpers live in src/utils/password.js so they can be unit
// tested without importing the CLI entry tree (SPEC.md §16.7). Imported here for
// internal use and re-exported below for the command layer / existing importers.
import {
  stripTrailingNewline,
  readPasswordFile,
  readPasswordStdin,
  hasNonInteractivePassword,
  resolvePassword,
} from '../../src/utils/password.js';

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
    const sep = pair.includes('=') ? '=' : ':';
    const idx = pair.indexOf(sep);
    if (idx === -1) {
      throw new Error(
        `Invalid --env format: "${pair}". Expected envName=filePath`
      );
    }
    const envName = pair.slice(0, idx);
    let filePath = pair.slice(idx + 1).trim();
    if (filePath.startsWith('~')) {
      filePath = os.homedir() + filePath.slice(1);
    }
    if (!envName || !filePath) {
      throw new Error(
        `Invalid --env format: "${pair}". Expected envName=filePath`
      );
    }
    entries[envName.trim()] = filePath;
  }
  return entries;
}

// Re-export the password helpers so existing importers of this module keep working.
export {
  stripTrailingNewline,
  readPasswordFile,
  readPasswordStdin,
  hasNonInteractivePassword,
  resolvePassword,
};

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
    console.error(chalk.red('No vault found.'));
    console.error(
      chalk.yellow(`  Create one:  vault env init --name ${cwdName}`)
    );
    console.error(
      chalk.yellow(`  Specify:     --vault <path> or --name <name>`)
    );
    process.exit(1);
  }

  return vaultPath;
}

/**
 * Interactive value entry for `env set KEY` (no value argument): open the
 * user's editor on a private temp file showing the previous value as
 * comments (SPEC.md §16). Returns the new value, or null to abort.
 * The temp file lives in a 0700 mkdtemp dir, is created 0600, and is
 * securely deleted afterwards — same hygiene as `env run --inject file`.
 */
async function editValueInEditor(key, envName, previousValue) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-env-'));
  const tmpFile = path.join(tmpDir, `${key}.txt`);

  try {
    await fs.writeFile(
      tmpFile,
      buildEditorTemplate(key, envName, previousValue),
      { mode: 0o600 }
    );
    await openInEditor(tmpFile);
    const content = await fs.readFile(tmpFile, 'utf-8');
    return parseEditorContent(content);
  } finally {
    secureDelete(tmpFile);
    try {
      fs.rmdirSync(tmpDir);
    } catch {
      // Best-effort cleanup; the dir is private (0700) and empty-ish.
    }
  }
}

async function loadVault(options) {
  const vaultPassword = await resolvePassword(options, 'Enter vault password:');
  const vaultPath = await resolveVaultPath(options);
  const result = await EnvironmentVaultService.loadVault(
    vaultPath,
    vaultPassword
  );

  if (!result.success) {
    console.error(chalk.red(result.error));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option(
      '-e, --env <pairs>',
      'Import .env files: envName=path (or envName:path)',
      (val, prev = {}) => ({ ...prev, ...parseEnvOption(val) }),
      {}
    )
    .action(async (options) => {
      try {
        const vaultPassword = await resolvePassword(
          options,
          'Enter vault password:'
        );

        if (!hasNonInteractivePassword(options)) {
          const confirm = await password({
            message: 'Confirm vault password:',
            mask: true,
          });
          if (vaultPassword !== confirm) {
            console.error(chalk.red('Passwords do not match.'));
            process.exit(1);
          }
        }

        const vaultPath = options.vault
          ? path.resolve(options.vault)
          : options.name
            ? EnvironmentVaultService.getEnvVaultPath(options.name)
            : EnvironmentVaultService.defaultVaultPath();

        const vaultModel = new EnvironmentVault();
        const envs = options.env || {};

        for (const [envName, envFile] of Object.entries(envs)) {
          const step = ora(
            `Reading ${chalk.cyan(envName)} from ${chalk.gray(envFile)}`
          ).start();
          let content;
          try {
            content = await fs.readFile(envFile, 'utf-8');
          } catch (err) {
            step.fail(chalk.red(`Cannot read ${envFile}: ${err.message}`));
            process.exit(1);
          }
          const parsed = EnvironmentVault.parseEnvFile(content);
          const count = Object.keys(parsed).length;
          vaultModel.importFromEnvFile(envName, content, {
            message: 'Initial import',
          });
          step.succeed(`Imported ${chalk.bold(envName)} (${count} variables)`);
        }

        const step = ora('Encrypting vault…').start();
        const result = await EnvironmentVaultService.createVault(
          vaultPath,
          vaultPassword,
          vaultModel.toJSON()
        );

        if (!result.success) {
          step.fail(chalk.red(result.error));
          process.exit(1);
        }

        step.succeed(
          chalk.green(`Environment vault created at ${result.path}`)
        );
      } catch (error) {
        console.error(chalk.red(error.message));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .action(async (envName, files, options) => {
      const spinner = ora('Importing .env files...').start();

      try {
        const vaultPassword = await resolvePassword(
          options,
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
    .argument(
      '[value]',
      'Variable value (omit to edit interactively in $EDITOR)'
    )
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('-e, --env <name>', 'Environment name (defaults to "default")')
    .option('--public', 'Mark variable as non-sensitive')
    .option('--required', 'Mark variable as required (checked by validate)')
    .option('-m, --message <text>', 'Version message')
    .action(async (key, value, options) => {
      try {
        if (value === undefined && !process.stdin.isTTY) {
          console.error(
            chalk.red(
              'No value provided. Pass a value argument when running non-interactively.'
            )
          );
          process.exit(1);
        }

        const { vaultPath, vaultPassword, vault } = await loadVault(options);
        const envName = options.env || 'default';

        if (value === undefined) {
          let previousValue;
          try {
            previousValue = vault.getActiveVersion(envName)?.vars?.[key];
          } catch {
            // Environment doesn't exist yet — treat as "no previous value".
          }

          value = await editValueInEditor(key, envName, previousValue);

          if (value === null) {
            console.log(chalk.yellow('Empty value — nothing changed.'));
            return;
          }
        }

        const spinner = ora(`Setting ${key}...`).start();

        const result = await EnvironmentVaultService.setEnv(
          vaultPath,
          vaultPassword,
          envName,
          key,
          value,
          {
            isPublic: !!options.public,
            isRequired: !!options.required,
            message: options.message,
          }
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Set ${key} in "${envName}".`));
      } catch (error) {
        console.error(chalk.red(error.message));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
          console.error(chalk.red(result.error));
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
        console.error(chalk.red(error.message));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('--json', 'Output as JSON')
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
          console.error(chalk.red(result.error));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(result.data, null, 2));
          return;
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
        console.error(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('list')
    .description('List all environments in the vault')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const result = await EnvironmentVaultService.listEnvs(
          vaultPath,
          vaultPassword
        );

        if (!result.success) {
          console.error(chalk.red(result.error));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(result.data, null, 2));
          return;
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
        console.error(chalk.red(error.message));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
          console.error(chalk.red(result.error));
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
        console.error(chalk.red(error.message));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
    .command('copy')
    .description('Copy an environment to a new name')
    .argument('<sourceName>', 'Environment to copy from')
    .argument('<destName>', 'New environment name')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .action(async (sourceName, destName, options) => {
      const spinner = ora(
        `Copying "${sourceName}" to "${destName}"...`
      ).start();

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const result = await EnvironmentVaultService.copyEnv(
          vaultPath,
          vaultPassword,
          sourceName,
          destName
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(
          chalk.green(`Copied "${sourceName}" to "${destName}".`)
        );
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
          console.error(chalk.red(result.error));
          process.exit(1);
        }

        console.log(result.data);
        if (options.clip) await copyToClipboard(result.data, 'template');
      } catch (error) {
        console.error(chalk.red(error.message));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('--json', 'Output as JSON')
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
          console.error(chalk.red(result.error));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(result.data, null, 2));
          return;
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
        console.error(chalk.red(error.message));
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
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
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('--json', 'Output as JSON')
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
          console.error(chalk.red(result.error));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(result.data, null, 2));
          return;
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
        console.error(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('validate')
    .description('Validate an environment (required keys present, value types)')
    .argument('[envName]', 'Environment name (defaults to "default")')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('--strict', 'Fail on warnings, not just errors')
    .option('--json', 'Output as JSON')
    .action(async (envName, options) => {
      try {
        const { vaultPath, vaultPassword } = await loadVault(options);
        const name = envName || 'default';

        const result = await EnvironmentVaultService.validateEnv(
          vaultPath,
          vaultPassword,
          name
        );

        if (!result.success) {
          console.error(chalk.red(result.error));
          process.exit(1);
        }

        const { errors, warnings, varCount, requiredCount } = result.data;

        if (options.json) {
          console.log(JSON.stringify(result.data, null, 2));
        } else {
          if (errors.length === 0) {
            console.log(
              chalk.green(
                `✓ ${name}: ${varCount} vars, ${requiredCount} required`
              )
            );
          }
          for (const e of errors) console.log(chalk.red(`✗ ${e}`));
          for (const w of warnings) console.log(chalk.yellow(`! ${w}`));
        }

        // Exit codes: 0 = pass, 1 = errors (or warnings under --strict),
        // 2 = passed with warnings.
        if (errors.length > 0) process.exit(1);
        if (warnings.length > 0) process.exit(options.strict ? 1 : 2);
      } catch (error) {
        console.error(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('run')
    .description('Run a command with the environment injected (no plaintext)')
    .argument('<envName>', 'Environment name')
    .argument('[command...]', 'Command to run (use -- before it)')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('--inject <mode>', 'Injection mode: clean | merge | file', 'clean')
    .option(
      '--out-file <path>',
      'Temp .env path to write (required for --inject file). Named --out-file ' +
        'because Node/Bun reserve --env-file as a built-in flag.'
    )
    .option(
      '--allowlist <vars>',
      'Extra system vars to pass through in clean mode (comma-separated)'
    )
    .action(async (envName, command, options) => {
      if (!command || command.length === 0) {
        console.error(
          chalk.red('No command specified. Usage: vault env run <env> -- <cmd>')
        );
        process.exit(1);
      }

      const mode = options.inject;
      if (!INJECT_MODES.includes(mode)) {
        console.error(
          chalk.red(`Invalid --inject mode "${mode}" (clean|merge|file)`)
        );
        process.exit(1);
      }
      if (mode === 'file' && !options.outFile) {
        console.error(
          chalk.red('--out-file <path> is required for --inject file')
        );
        process.exit(1);
      }

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const exportResult = await EnvironmentVaultService.exportEnv(
          vaultPath,
          vaultPassword,
          envName,
          'json'
        );
        if (!exportResult.success) {
          console.error(chalk.red(exportResult.error));
          process.exit(1);
        }

        const vars = exportResult.data;
        const childEnv = buildChildEnv({
          mode,
          vars,
          parentEnv: process.env,
          allowlist: parseAllowlist(options.allowlist),
        });

        let envFilePath = null;
        if (mode === 'file') {
          envFilePath = path.resolve(options.outFile);
          fs.writeFileSync(envFilePath, toDotenv(vars), { mode: 0o600 });
        }

        const cleanup = () => {
          if (envFilePath) secureDelete(envFilePath);
        };

        const child = spawn(command[0], command.slice(1), {
          stdio: 'inherit',
          env: childEnv,
        });

        const forward = (signal) => child.kill(signal);
        process.on('SIGINT', forward);
        process.on('SIGTERM', forward);

        child.on('error', (err) => {
          cleanup();
          const msg =
            err.code === 'ENOENT'
              ? `Command not found: ${command[0]}`
              : `Failed to run command: ${err.message}`;
          console.error(chalk.red(msg));
          process.exit(127);
        });

        child.on('exit', (code, signal) => {
          cleanup();
          process.removeListener('SIGINT', forward);
          process.removeListener('SIGTERM', forward);
          // Propagate the child's exit status; map a terminating signal to 1.
          process.exit(signal ? 1 : (code ?? 0));
        });
      } catch (error) {
        console.error(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('change-password')
    .description('Change the vault password')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Current vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .action(async (options) => {
      const spinner = ora('Changing vault password...').start();

      try {
        const vaultPath = await resolveVaultPath(options);
        const currentPassword = await resolvePassword(
          options,
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

import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import { Option } from 'commander';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import password from '@inquirer/password';

import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';
import { EnvironmentVault } from '../../src/electron/models/EnvironmentVault.js';
import {
  INJECT_MODES,
  DEFAULT_ALLOWLIST_FILE,
  buildChildEnv,
  toDotenv,
  parseAllowlist,
  readAllowlistFile,
  loadProjectConfig,
  applyProjectConfig,
  secureDelete,
  cleanupOrphanTempDirs,
  getRunCommand,
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
    log(chalk.gray(`  Copied ${label} to clipboard`));
  } catch {
    log(chalk.yellow('  Clipboard not available on this system'));
  }
}

let isQuiet = false;

const EXIT = {
  PASSWORD_SOURCE_CONFLICT: { code: 2, symbol: 'PASSWORD_SOURCE_CONFLICT' },
  PASSWORD_FILE_UNREADABLE: { code: 3, symbol: 'PASSWORD_FILE_UNREADABLE' },
  PASSWORD_STDIN_FAILED: { code: 4, symbol: 'PASSWORD_STDIN_FAILED' },
  ENV_VAULT_NOT_FOUND: { code: 5, symbol: 'ENV_VAULT_NOT_FOUND' },
  ENV_VAULT_DECRYPT_FAILED: { code: 6, symbol: 'ENV_VAULT_DECRYPT_FAILED' },
  ENV_NOT_FOUND: { code: 7, symbol: 'ENV_NOT_FOUND' },
  KEY_NOT_FOUND: { code: 8, symbol: 'KEY_NOT_FOUND' },
  REFERENCE_CYCLE: { code: 9, symbol: 'REFERENCE_CYCLE' },
  REFERENCE_NOT_FOUND: { code: 10, symbol: 'REFERENCE_NOT_FOUND' },
  MAX_DEPTH_EXCEEDED: { code: 11, symbol: 'MAX_DEPTH_EXCEEDED' },
  VALIDATION_ERROR: { code: 12, symbol: 'VALIDATION_ERROR' },
  FILE_WRITE_FAILED: { code: 13, symbol: 'FILE_WRITE_FAILED' },
  INJECTION_FAILED: { code: 14, symbol: 'INJECTION_FAILED' },
};

function fail(spec, message) {
  console.error(`[${spec.symbol}] ${message}`);
  process.exit(spec.code);
}

const EXIT_BY_SYMBOL = Object.fromEntries(
  Object.values(EXIT).map((e) => [e.symbol, e])
);

function passwordFailFn(symbol, message) {
  const spec = EXIT_BY_SYMBOL[symbol];
  console.error(`[${spec.symbol}] ${message}`);
  process.exit(spec.code);
}

function log(...args) {
  if (!isQuiet) console.log(...args);
}

function oraQuiet(text) {
  if (isQuiet) {
    return {
      start: () => {},
      succeed: () => {},
      fail: (msg) => {
        if (msg) console.error(msg);
      },
      get text() {
        return '';
      },
      set text(_v) {},
    };
  }
  return ora(text);
}

function parseExtendsOption(val) {
  const entries = {};
  for (const pair of val.split(',')) {
    const sep = pair.includes('=') ? '=' : ':';
    const idx = pair.indexOf(sep);
    const child = idx === -1 ? '' : pair.slice(0, idx).trim();
    const parent = idx === -1 ? '' : pair.slice(idx + 1).trim();
    if (!child || !parent) {
      throw new Error(
        `Invalid --extends format: "${pair}". Expected envName:parentName`
      );
    }
    entries[child] = parent;
  }
  return entries;
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
    const cwd = process.cwd();
    const cwdName = path
      .basename(cwd)
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    const gitRoot = EnvironmentVaultService.findGitRoot(cwd);
    const stopDir = gitRoot || cwd;
    const appDataPath = EnvironmentVaultService.getEnvVaultPath(cwdName);

    fail(
      EXIT.ENV_VAULT_NOT_FOUND,
      `No vault found.\n` +
        `Searched:\n` +
        `  - .env.vault in ${cwd} (and parents up to ${stopDir})\n` +
        `  - config/.env.vault (in ${cwd})\n` +
        `  - ${appDataPath}\n` +
        `\n` +
        `Create one: vault env init --name ${cwdName}`
    );
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
  const vaultPath = await resolveVaultPath(options);

  if (!(await EnvironmentVaultService.vaultExists(vaultPath))) {
    fail(EXIT.ENV_VAULT_NOT_FOUND, `Vault file does not exist at ${vaultPath}`);
  }

  const vaultPassword = await resolvePassword(
    options,
    'Enter vault password:',
    {
      failFn: passwordFailFn,
    }
  );

  const result = await EnvironmentVaultService.loadVault(
    vaultPath,
    vaultPassword
  );

  if (!result.success) {
    const spec = result.error.includes('not found')
      ? EXIT.ENV_VAULT_NOT_FOUND
      : EXIT.ENV_VAULT_DECRYPT_FAILED;
    fail(spec, result.error);
  }

  return { vaultPath, vaultPassword, vault: result.data };
}

export function registerEnvCommand(program) {
  cleanupOrphanTempDirs();

  const env = program
    .command('env')
    .description('Manage environment vaults')
    .option('--quiet', 'Suppress non-error output');

  env.hook('preAction', (thisCmd) => {
    isQuiet = !!thisCmd.opts().quiet;
  });

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
    .option(
      '--extends <pairs>',
      'Set layering: envName:parentName (repeatable, comma-separated)',
      (val, prev = {}) => ({ ...prev, ...parseExtendsOption(val) }),
      {}
    )
    .option(
      '--description <text>',
      'Optional description for the vault environments'
    )
    .action(async (options) => {
      try {
        const vaultPassword = await resolvePassword(
          options,
          'Enter vault password:',
          { failFn: passwordFailFn }
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
          const step = oraQuiet(
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
          if (options.description && vaultModel.environments[envName]) {
            vaultModel.environments[envName].description = options.description;
          }
          step.succeed(`Imported ${chalk.bold(envName)} (${count} variables)`);
        }

        // Apply --extends layering once all environments exist in the model.
        for (const [child, parent] of Object.entries(options.extends || {})) {
          try {
            vaultModel.setExtends(child, parent);
          } catch (err) {
            console.error(chalk.red(err.message));
            process.exit(1);
          }
        }

        const step = oraQuiet('Encrypting vault…').start();
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
      const spinner = oraQuiet('Importing .env files...').start();

      try {
        const vaultPassword = await resolvePassword(
          options,
          'Enter vault password:',
          { failFn: passwordFailFn }
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
    .option('--extends <parent>', 'Set this environment to extend <parent>')
    .option('-m, --message <text>', 'Version message')
    .option('--description <text>', 'Set environment description')
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
            log(chalk.yellow('Empty value — nothing changed.'));
            return;
          }
        }

        const spinner = oraQuiet(`Setting ${key}...`).start();

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

        // Apply --extends after the write so the environment is guaranteed to
        // exist (setEnv auto-creates it on first use).
        if (options.extends) {
          const extendsResult = await EnvironmentVaultService.setExtends(
            vaultPath,
            vaultPassword,
            envName,
            options.extends
          );
          if (!extendsResult.success) {
            spinner.fail(chalk.red(extendsResult.error));
            process.exit(1);
          }
        }

        if (options.description !== undefined) {
          const descResult = await EnvironmentVaultService.setEnvDescription(
            vaultPath,
            vaultPassword,
            envName,
            options.description
          );
          if (!descResult.success) {
            spinner.fail(chalk.red(descResult.error));
            process.exit(1);
          }
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
        console.log(chalk.gray(`  Description: ${data.description}`));
        console.log(
          chalk.gray(
            `  Active version: v${data.activeVersion} of ${data.totalVersions}`
          )
        );
        console.log(
          chalk.gray(
            `  Created: ${new Date(data.created).toLocaleDateString()}`
          )
        );
        console.log(
          chalk.gray(
            `  Updated: ${new Date(data.updated).toLocaleDateString()}`
          )
        );
        console.log(chalk.gray(`  Extends: ${data.extends}`));
        console.log(chalk.gray(`  Variables: ${data.keyCount}\n`));

        for (const k of data.keys) {
          const display = k.sensitive
            ? k.value.length > 8
              ? k.value.slice(0, 4) + '****' + k.value.slice(-4)
              : '****'
            : k.value;
          console.log(`  ${chalk.cyan(k.key)} = ${display}`);
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
          log(chalk.yellow('\n  No environments in this vault.\n'));
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
      const spinner = oraQuiet(`Removing ${key}...`).start();

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

        // JSON format returns an object; emit valid JSON (not util.inspect)
        // so the output can be piped, e.g. into `docker compose --env-file`.
        const text =
          typeof result.data === 'string'
            ? result.data
            : JSON.stringify(result.data, null, 2);

        if (options.clip) {
          await copyToClipboard(text, 'export');
        }
        console.log(text);
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
      const spinner = oraQuiet(`Deleting environment "${envName}"...`).start();

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
      const spinner = oraQuiet(
        `Renaming "${oldName}" to "${newName}"...`
      ).start();

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
    .command('extends')
    .description('Set or clear the parent an environment extends (layering)')
    .argument('<envName>', 'Environment to configure')
    .argument('[parent]', 'Parent environment to extend (omit with --none)')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .option('--none', 'Clear the parent (stop extending)')
    .action(async (envName, parent, options) => {
      if (!options.none && !parent) {
        console.error(
          chalk.red('Specify a <parent> environment, or pass --none to clear.')
        );
        process.exit(1);
      }
      if (options.none && parent) {
        console.error(chalk.red('Pass either a <parent> or --none, not both.'));
        process.exit(1);
      }

      const target = options.none ? null : parent;
      const spinner = oraQuiet(
        target
          ? `Setting "${envName}" to extend "${target}"...`
          : `Clearing parent of "${envName}"...`
      ).start();

      try {
        const { vaultPath, vaultPassword } = await loadVault(options);

        const result = await EnvironmentVaultService.setExtends(
          vaultPath,
          vaultPassword,
          envName,
          target
        );

        if (!result.success) {
          spinner.fail(chalk.red(result.error));
          process.exit(1);
        }

        spinner.succeed(
          chalk.green(
            target
              ? `"${envName}" now extends "${target}".`
              : `"${envName}" no longer extends a parent.`
          )
        );
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
      const spinner = oraQuiet(
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
          log(chalk.yellow('\n  No history for this environment.\n'));
          return;
        }

        console.log(
          chalk.bold(
            `\nHistory for "${name}" (${result.data.length} versions):\n`
          )
        );

        for (const v of result.data) {
          const date = new Date(v.created).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const active = v.isActive ? chalk.green(' (active)') : '';
          const msg = v.message ? v.message : '(unlabeled)';
          console.log(
            `  v${String(v.n).padStart(2)}  ${chalk.gray(date)}  ${msg}${active}`
          );
        }
        console.log();
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
      const spinner = oraQuiet(`Rolling back to v${versionN}...`).start();

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
      const spinner = oraQuiet(
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
        if (data.changedDetails.length > 0) {
          console.log(chalk.yellow('  Changed:'));
          for (const c of data.changedDetails) {
            const valA = c.sensitiveA ? '[masked]' : c.valueA;
            const valB = c.sensitiveB ? '[masked]' : c.valueB;
            console.log(
              `    ${chalk.cyan(c.key)} ${valA}  ${chalk.gray('→')}  ${valB}`
            );
          }
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
        if (errors.length > 0) {
          console.error(`[VALIDATION_ERROR] ${errors.length} error(s) found`);
          process.exit(1);
        }
        if (warnings.length > 0) {
          if (options.strict) {
            console.error(
              `[VALIDATION_ERROR] ${warnings.length} warning(s) found (strict mode)`
            );
            process.exit(1);
          }
          process.exit(2);
        }
      } catch (error) {
        console.error(chalk.red(error.message));
        process.exit(1);
      }
    });

  env
    .command('run')
    .description('Run a command with the environment injected (no plaintext)')
    .argument('[envName]', 'Environment name (overrides VAULT_ENV)')
    .argument('[command...]', 'Command to run (use -- before it)')
    .addOption(new Option('-n, --name <name>', 'Vault name').env('VAULT_NAME'))
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .addOption(
      new Option('--inject <mode>', 'Injection mode: clean | merge | file')
        .default('clean')
        .env('VAULT_INJECT')
    )
    .option(
      '--out-file <path>',
      'Temp .env path to write (required for --inject file). Named --out-file ' +
        'because Node/Bun reserve --env-file as a built-in flag.'
    )
    .option(
      '--allowlist <vars>',
      'Extra system vars to pass through in clean mode (comma-separated)'
    )
    .option(
      '--allowlist-file <path>',
      `File of vars to pass through in clean mode (one per line, # comments). ` +
        `Defaults to ${DEFAULT_ALLOWLIST_FILE} in CWD if present.`
    )
    .option(
      '--dry-run',
      'Print the resolved environment without running the command'
    )
    .action(async (envNameArg, commandArg, options, cmd) => {
      // The command comes from after the `--` wall (extractRunCommand) when one
      // was present; otherwise fall back to Commander's positional parsing for
      // the no-`--` form (`vault env run <env> <cmd>...`).
      const command = getRunCommand() ?? commandArg;
      if (!options.dryRun && (!command || command.length === 0)) {
        console.error(
          chalk.red('No command specified. Usage: vault env run <env> -- <cmd>')
        );
        process.exit(1);
      }

      try {
        const rc = loadProjectConfig();
        applyProjectConfig(cmd, rc);
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }

      // Resolve environment name: positional arg > VAULT_ENV > error.
      const envName = envNameArg || process.env.VAULT_ENV;
      if (!envName) {
        console.error(
          chalk.red(
            'No environment specified. Pass it as an argument or set VAULT_ENV.'
          )
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

        // Resolve allowlist file: explicit flag (must exist) or CWD default (optional).
        const allowlistFilePath = options.allowlistFile
          ? path.resolve(options.allowlistFile)
          : path.resolve(DEFAULT_ALLOWLIST_FILE);
        const fileAllowlist = readAllowlistFile(allowlistFilePath, {
          mustExist: !!options.allowlistFile,
        });

        const childEnv = buildChildEnv({
          mode,
          vars,
          parentEnv: process.env,
          allowlist: [...parseAllowlist(options.allowlist), ...fileAllowlist],
        });

        if (options.dryRun) {
          // Build a sensitivity map from showEnv; inherited vars default to sensitive.
          const showResult = await EnvironmentVaultService.showEnv(
            vaultPath,
            vaultPassword,
            envName
          );
          const sensitiveMap = {};
          if (showResult.success) {
            for (const { key, sensitive } of showResult.data.keys) {
              sensitiveMap[key] = sensitive;
            }
          }

          const modeLabel =
            mode === 'file'
              ? `${mode} (vars written to ${options.outFile ?? '<out-file>'})`
              : mode;
          log(
            chalk.bold(
              `\nDry run — env: ${chalk.cyan(envName)}  mode: ${chalk.cyan(modeLabel)}\n`
            )
          );

          for (const [key, value] of Object.entries(childEnv)) {
            const isVaultVar = key in vars;
            const isSensitive = sensitiveMap[key] ?? true; // unknown → sensitive
            const display =
              isVaultVar && isSensitive ? chalk.gray('****') : value;
            const prefix = isVaultVar ? chalk.green('+') : chalk.gray(' ');
            log(`  ${prefix} ${chalk.cyan(key)}=${display}`);
          }

          log(
            chalk.gray(
              `\n  ${chalk.green('+')} = from vault   (others inherited from parent env)\n`
            )
          );
          return;
        }

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
    .command('shell')
    .description('Open an interactive shell with vault vars loaded')
    .argument('[envName]', 'Environment name (overrides VAULT_ENV)')
    .addOption(new Option('-n, --name <name>', 'Vault name').env('VAULT_NAME'))
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .option('--password-file <path>', 'Read vault password from a file')
    .option('--password-stdin', 'Read vault password from stdin')
    .addOption(
      new Option('--inject <mode>', 'Injection mode: clean | merge')
        .default('clean')
        .env('VAULT_INJECT')
    )
    .option(
      '--allowlist <vars>',
      'Extra system vars to pass through in clean mode (comma-separated)'
    )
    .option(
      '--allowlist-file <path>',
      `File of vars to pass through in clean mode (one per line, # comments). ` +
        `Defaults to ${DEFAULT_ALLOWLIST_FILE} in CWD if present.`
    )
    .action(async (envNameArg, options, cmd) => {
      try {
        const rc = loadProjectConfig();
        applyProjectConfig(cmd, rc);
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }

      const envName = envNameArg || process.env.VAULT_ENV;
      if (!envName) {
        console.error(
          chalk.red(
            'No environment specified. Pass it as an argument or set VAULT_ENV.'
          )
        );
        process.exit(1);
      }

      const mode = options.inject;
      if (!['clean', 'merge'].includes(mode)) {
        console.error(
          chalk.red(`Invalid --inject mode "${mode}" for shell (clean|merge)`)
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

        const allowlistFilePath = options.allowlistFile
          ? path.resolve(options.allowlistFile)
          : path.resolve(DEFAULT_ALLOWLIST_FILE);
        const fileAllowlist = readAllowlistFile(allowlistFilePath, {
          mustExist: !!options.allowlistFile,
        });

        const childEnv = buildChildEnv({
          mode,
          vars,
          parentEnv: process.env,
          allowlist: [...parseAllowlist(options.allowlist), ...fileAllowlist],
        });

        // Let prompts (starship, oh-my-zsh, etc.) detect the active vault context.
        childEnv.VAULT_SHELL = '1';
        childEnv.VAULT_SHELL_ENV = envName;

        const shell = process.env.SHELL || '/bin/sh';
        log(
          chalk.bold(
            `\nOpening ${chalk.cyan(mode)} shell for env ${chalk.cyan(envName)} (${chalk.gray(shell)})\n` +
              chalk.gray(`  Type 'exit' or press Ctrl-D to return.\n`)
          )
        );

        const child = spawn(shell, [], { stdio: 'inherit', env: childEnv });

        const forward = (signal) => child.kill(signal);
        process.on('SIGINT', forward);
        process.on('SIGTERM', forward);

        child.on('error', (err) => {
          const msg =
            err.code === 'ENOENT'
              ? `Shell not found: ${shell}`
              : `Failed to open shell: ${err.message}`;
          console.error(chalk.red(msg));
          process.exit(127);
        });

        child.on('exit', (code, signal) => {
          process.removeListener('SIGINT', forward);
          process.removeListener('SIGTERM', forward);
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
      const spinner = oraQuiet('Changing vault password...').start();

      try {
        const vaultPath = await resolveVaultPath(options);
        const currentPassword = await resolvePassword(
          options,
          'Enter current password:',
          { failFn: passwordFailFn }
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

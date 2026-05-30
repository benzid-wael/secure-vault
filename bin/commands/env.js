import chalk from 'chalk';
import ora from 'ora';
import password from '@inquirer/password';

import { EnvironmentVaultService } from '../../src/electron/services/EnvironmentVaultService.js';

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

async function resolveVaultPath(options, spinner) {
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
    spinner.fail(chalk.red('No vault found.'));
    console.log(
      chalk.yellow(`  Create one:  vault env init --name ${cwdName}`)
    );
    console.log(chalk.yellow(`  Specify:     --vault <path> or --name <name>`));
    process.exit(1);
  }

  return vaultPath;
}

export function registerVaultCommand(program) {
  const vault = program
    .command('vault')
    .description('Manage environment vaults');

  vault
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
      let spinner = ora('Initializing environment vault...').start();

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

  vault
    .command('import')
    .description('Import .env files into an existing vault')
    .argument('<envName>', 'Environment name (e.g. staging, production)')
    .argument('[files...]', 'One or more .env files to import')
    .option('-n, --name <name>', 'Vault name')
    .option('-v, --vault <path>', 'Exact vault file path')
    .option('--password <password>', 'Vault password (non-interactive)')
    .action(async (envName, files, options) => {
      let spinner = ora('Importing .env files...').start();

      try {
        const vaultPassword = await getPassword(
          options.password,
          'Enter vault password:'
        );
        const vaultPath = await resolveVaultPath(options, spinner);

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

  return vault;
}

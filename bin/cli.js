#!/usr/bin/env node
import chalk from 'chalk';
import figlet from 'figlet';
import ora from 'ora';
import password from '@inquirer/password';

import { program } from 'commander';
import standardFont from 'figlet/importable-fonts/Standard.js';
import secureVault from '../package.json' with { type: 'json' };

// Register the font explicitly so the banner survives bundling into a
// standalone binary, where figlet cannot read .flf font files from disk.
figlet.parseFont('Standard', standardFont);

function banner(text) {
  try {
    return figlet.textSync(text, {
      font: 'Standard',
      horizontalLayout: 'full',
    });
  } catch {
    return text;
  }
}

import { VaultFileService } from '../src/electron/services/VaultFileService.js';
import { VaultService } from '../src/electron/services/VaultService.js';
import { VaultRecoveryService } from '../src/electron/services/VaultRecoveryService.js';
import { getVaultsDir } from '../src/electron/utils/appPaths.js';
import { registerEnvCommand } from './commands/env.js';
import { injectVaultEnvArg } from './commands/envRunHelpers.js';

program
  .name('SecureVault')
  .version(secureVault.version)
  .description('SecureVault CLI');

program.command('info').action((options) => {
  const vaultDir = getVaultsDir();
  console.log(chalk.yellow(banner('SecureVault CLI')));
  console.log();
  console.log('Version: ', secureVault.version);
  console.log('Vault directory: ', vaultDir);
});

program
  .command('recover')
  .option('-n, --name <vaultName>', 'Vault name')
  .action(async (options) => {
    let spinner = ora(`Recovering vault: ${options.name}`).start();

    const vaultDir = getVaultsDir();
    const vfs = new VaultFileService(vaultDir);
    if (!vfs.vaultExists(options.name)) {
      spinner.failed(chalk.green('Vault not found!'));
    }
    spinner.succeed(chalk.green('Vault exists!'));

    const vs = new VaultService(vaultDir);
    let masterPassword = '';
    let is_valid = false;
    while (!is_valid) {
      masterPassword = await password({
        message: 'Enter your password: ',
        mask: true,
      });
      const result = await vs.verifyPassword(options.name, masterPassword);
      is_valid = result.success;
    }
    ora().start().succeed('Valid master password!');

    spinner = ora('Recovering vault').start();
    const recoveryService = new VaultRecoveryService(vaultDir);
    const recovered = recoveryService.recover(options.name, masterPassword);
    if (recovered) {
      spinner.succeed('Vault recovered successfully!');
    } else {
      spinner.failed('Failed to recover vault!');
    }
  });

registerEnvCommand(program);

program.parse(injectVaultEnvArg(process.argv));

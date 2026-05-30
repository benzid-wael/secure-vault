#!/usr/bin/env node
import path from 'path';
import chalk from 'chalk';
import figlet from 'figlet';
import ora from 'ora';
import password from '@inquirer/password';

import { program } from 'commander';
import secureVault from '../package.json' with { type: 'json' };

import { VaultFileService } from '../src/electron/services/VaultFileService.js';
import { VaultService } from '../src/electron/services/VaultService.js';
import { VaultRecoveryService } from '../src/electron/services/VaultRecoveryService.js';
import { registerVaultCommand } from './commands/env.js';

program
  .name('SecureVault')
  .version(secureVault.version)
  .description('SecureVault CLI');

program.command('info').action((options) => {
  const vaultDir = path.join(getAppDataPath(), 'vaults');
  console.log(
    chalk.yellow(
      figlet.textSync('SecureVault CLI', { horizontalLayout: 'full' })
    )
  );
  console.log();
  console.log('Version: ', secureVault.version);
  console.log('Vault directory: ', vaultDir);
});

program
  .command('recover')
  .option('-n, --name <vaultName>', 'Vault name')
  .action(async (options) => {
    let spinner = ora(`Recovering vault: ${options.name}`).start();

    const vaultDir = path.join(getAppDataPath(), 'vaults');
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

function getAppDataPath() {
  switch (process.platform) {
    case 'darwin': {
      return path.join(
        process.env.HOME,
        'Library',
        'Application Support',
        secureVault.name
      );
    }
    case 'win32': {
      return path.join(process.env.APPDATA, secureVault.name);
    }
    case 'linux': {
      return path.join(process.env.HOME, `.${secureVault.name}`);
    }
    default: {
      console.log('Unsupported platform!');
      process.exit(1);
    }
  }
}

registerVaultCommand(program);

program.parse(process.argv);

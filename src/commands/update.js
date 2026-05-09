'use strict';

const { exec } = require('child_process');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');

/**
 * Tejas Update Command
 * Automates git pull and npm install to keep the system at 'God Level'.
 */
async function updateTejas() {
  const projectRoot = path.join(__dirname, '../../');
  console.log(chalk.blue.bold('\n🚀 Tejas System Update\n'));

  const spinner = ora('Checking for updates...').start();

  // 1. Git Pull
  try {
    await runCommand('git pull', projectRoot);
    spinner.succeed('Repository updated to latest version.');
  } catch (err) {
    spinner.fail('Failed to update repository: ' + err.message);
    process.exit(1);
  }

  // 2. NPM Install
  spinner.start('Syncing dependencies...');
  try {
    await runCommand('npm install', projectRoot);
    spinner.succeed('Dependencies synchronized.');
  } catch (err) {
    spinner.fail('Failed to sync dependencies: ' + err.message);
    process.exit(1);
  }

  console.log(chalk.green.bold('\n✨ Tejas is now up to date and ready for action!\n'));
}

function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

module.exports = updateTejas;

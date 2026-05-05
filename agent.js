'use strict';

const chalk       = require('chalk');
const display     = require('../utils/display');
const AgentRouter = require('../agents/router');

module.exports = async function agent(options) {
  const router = new AgentRouter(null, null);
  const AGENTS = router.getAgentList();

  if (options.list || (!options.start && !options.kill && !options.info)) {
    display.section('Tejas Agent Registry');
    display.br();
    AGENTS.forEach(a => {
      const badge = a.status === 'active' ? chalk.green('● ACTIVE  ') : chalk.yellow('○ PLANNED');
      console.log(chalk.gray('  ') + badge + '  ' + chalk.bold.white(a.name.padEnd(12)) + chalk.gray(a.description));
    });
    display.br();
    console.log(chalk.gray('  Use: ') + chalk.cyan('tejas agent --info <name>') + chalk.gray(' for details'));
    display.br();
    return;
  }

  if (options.info) {
    const a = AGENTS.find(ag => ag.name === options.info.toLowerCase());
    if (!a) { display.error(`Unknown agent: ${options.info}`); return; }
    display.br();
    display.box(
      chalk.bold(a.name.toUpperCase()) + '\n\n' +
      chalk.white(a.description) + '\n\n' +
      chalk.cyan('Triggers:\n') +
      (a.triggers || []).map(t => chalk.gray('  • ') + chalk.white(t)).join('\n') + '\n\n' +
      chalk.white('Status: ') + (a.status === 'active' ? chalk.green('● Active') : chalk.yellow('○ Planned')),
      'Agent Info', a.status === 'active' ? 'green' : 'yellow'
    );
    return;
  }

  if (options.start) {
    const a = AGENTS.find(ag => ag.name === options.start);
    if (!a) { display.error(`Unknown agent: ${options.start}`); return; }
    if (a.status === 'planned') { display.warn(`Agent "${a.name}" is coming soon.`); return; }
    display.success(`Agent "${a.name}" is active. Use: tejas run "<task>" --agent ${a.name}`);
    return;
  }

  if (options.kill) {
    display.info(`Agent "${options.kill}" — stateless, nothing to stop.`);
  }
};

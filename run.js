'use strict';

const inquirer      = require('inquirer');
const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const AIEngine      = require('../core/ai');
const Executor      = require('../core/executor');
const AgentRouter   = require('../agents/router');
const display       = require('../utils/display');

// ─── RUN COMMAND ─────────────────────────────────────────────────────────────
module.exports = async function run(task, options) {
  const memory   = new MemoryManager(process.cwd());
  const executor = new Executor({ verbose: options.verbose, cwd: process.cwd() });

  if (!await memory.exists()) {
    display.error('Tejas not initialized. Run: tejas init');
    process.exit(1);
  }

  const config  = await memory.readConfig();
  const ai      = new AIEngine({ ...config, verbose: options.verbose });
  const context = await memory.getContextSummary(task);
  const router  = new AgentRouter(ai, memory);

  display.section('Running Task');
  display.info(chalk.bold(task));
  display.br();

  // ── Route to correct agent ──
  const routeSpin = display.spinner('Routing to best agent...').start();
  let routing;

  try {
    routing = await router.route(task, options, context);
    routeSpin.succeed(chalk.green(`Agent: ${chalk.cyan(routing.agent)}`));
  } catch (err) {
    if (options.verbose) console.error('Routing error:', err.message);
    routeSpin.fail('Routing failed — using workflow agent');
    routing = { agent: 'workflow', useNativeExecutor: true };
  }

  display.br();

  // ── SPECIALIST AGENTS (web, file, code) ───────────────────────────────────
  if (!routing.useNativeExecutor && routing.result) {
    const r = routing.result;

    if (r.success) {
      display.success(`${routing.agent} agent completed`);
      display.br();
      if (r.output) console.log(chalk.white(r.output));
      display.br();
    } else {
      display.error(`${routing.agent} agent failed: ${r.error}`);
      display.info('Falling back to workflow agent...');
      display.br();
      routing.useNativeExecutor = true;
    }

    await memory.logTask({
      task,
      agent:         routing.agent,
      steps:         r.steps?.length || 1,
      steps_detail:  r.steps || [],
      success:       r.success,
      duration_ms:   0,
      plan_summary:  task,
      error_message: r.error || null
    });

    if (r.success) return;
  }

  // ── WORKFLOW AGENT (native executor) ──────────────────────────────────────
  const similar = await memory.search(task);
  if (similar.length > 0 && similar[0].type === 'workflow') {
    display.dim(`Found similar workflow: "${similar[0].name}" — using as context`);
  }

  const spin = display.spinner('Thinking...').start();
  let plan;

  try {
    plan = await ai.decomposeTask(task, context);
    spin.succeed(chalk.green('Plan ready'));
  } catch (err) {
    spin.fail(chalk.red('AI error: ' + err.message));
    display.error('Could not process task. Check: tejas config --list');
    process.exit(1);
  }

  const isSimpleTalk = plan.steps.length === 1 && plan.steps[0].action === 'explain';
  if (!isSimpleTalk) {
    display.agentPlan(plan);
  }

  const hasShellSteps = plan.steps.some(s => s.action === 'shell');
  if (plan.requires_confirmation || hasShellSteps) {
    const { confirmed } = await inquirer.prompt([{
      type: 'confirm', name: 'confirmed',
      message: `Execute ${plan.steps.length} steps?`, default: true
    }]);
    if (!confirmed) { display.warn('Task cancelled.'); return; }
  }

  display.br();

  const execSpin = display.spinner('Executing steps...').start();
  const results  = await executor.runSteps(plan.steps, (step, result) => {
    execSpin.stop();
    display.stepResult(step, result);
    execSpin.start();
  });
  execSpin.stop();

  const passed  = results.filter(r => r.success).length;
  const failed  = results.filter(r => !r.success).length;
  const totalMs = results.reduce((sum, r) => sum + r.duration_ms, 0);

  display.br();
  if (failed === 0) {
    display.success(`All ${passed} steps completed in ${totalMs}ms`);
  } else {
    display.warn(`${passed} succeeded, ${failed} failed`);
  }

  display.br();
};

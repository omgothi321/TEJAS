'use strict';

const chalk         = require('chalk');
const MemoryManager = require('../core/memory');
const AIEngine      = require('../core/ai');
const AgentRouter   = require('../agents/router');
const VoiceEngine   = require('../tts/speak');
const display       = require('../utils/display');

// ─── VOICE COMMAND ────────────────────────────────────────────────────────────
module.exports = async function voice(options) {
  const memory = new MemoryManager(process.cwd());

  if (!await memory.exists()) {
    display.error('Tejas not initialized. Run: tejas init');
    process.exit(1);
  }

  await memory.initialize();

  const config = await memory.readConfig();
  const ai     = new AIEngine(config);
  const router = new AgentRouter(ai, memory);
  const engine = new VoiceEngine({
    wakeWord:    options.wakeWord || config.preferences?.wake_word || 'tejas',
    ttsEngine:   options.tts || 'auto',
    sttEngine:   options.stt || 'groq',
    groqApiKey:  config.api_keys?.groq || process.env.GROQ_API_KEY || null,
  });

  // ── BANNER ──────────────────────────────────────────────────────────────
  display.br();
  console.log(chalk.bold.magenta('  ◈ TEJAS VOICE MODE'));
  console.log(chalk.gray('  ─────────────────────────────────'));
  display.br();

  // ── INIT ENGINE ─────────────────────────────────────────────────────────
  const spin = display.spinner('Initializing voice systems...').start();
  const caps = await engine.init();
  spin.stop();

  console.log(chalk.gray('  TTS (text-to-speech): ') + (caps.tts ? chalk.green('✓ ' + caps.tts) : chalk.red('✗ not found')));
  console.log(chalk.gray('  STT (speech-to-text): ') + (caps.stt ? chalk.green('✓ ' + caps.stt) : chalk.yellow('⚠ not found — text mode only')));
  console.log(chalk.gray('  Wake word:            ') + chalk.cyan('"' + caps.wakeWord + '"'));
  display.br();

  if (!caps.tts) {
    display.warn('No TTS engine found. Install espeak-ng:');
    console.log(chalk.cyan('  sudo apt install espeak-ng'));
    display.br();
    display.info('Continuing in text-only mode...');
    display.br();
  }

  // ── MODE SELECTION ───────────────────────────────────────────────────────
  if (options.speak) {
    // One-shot TTS mode: tejas voice --speak "hello world"
    await engine.speak(options.speak);
    return;
  }

  if (options.listen) {
    // One-shot STT mode: tejas voice --listen
    await _listenOnce(engine, ai, router, memory);
    return;
  }

  if (options.jarvis || options.continuous) {
    // Full Tejas mode: continuous wake word loop
    await _tejasMode(engine, ai, router, memory, options);
    return;
  }

  // Default: interactive voice REPL
  await _voiceREPL(engine, ai, router, memory, options);
};

// ─── INTERACTIVE VOICE REPL ───────────────────────────────────────────────────
// Type or speak — Tejas responds with voice + text
async function _voiceREPL(engine, ai, router, memory, options) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout
  });

  console.log(chalk.bold.white('  Voice REPL — Tejas Voice Interface'));
  console.log(chalk.gray('  Type a command or press Enter to speak'));
  console.log(chalk.gray('  Commands: .tejas | .speak <text> | .status | .exit'));
  display.br();

  if (engine._ttsAvailable) {
    await engine.speak('Tejas online. Ready for your command.');
  }

  const ask = () => {
    rl.question(chalk.cyan('  tejas> '), async (input) => {
      const cmd = input.trim();

      if (!cmd) {
        // Empty input → try voice listen
        if (engine._sttAvailable) {
          console.log(chalk.gray('  Listening... (speak now)'));
          try {
            const heard = await engine.listenOnce(7000);
            if (heard) {
              console.log(chalk.gray('  Heard: ') + chalk.white('"' + heard + '"'));
              await _executeVoiceTask(heard, engine, ai, router, memory);
            } else {
              console.log(chalk.gray('  (nothing heard)'));
            }
          } catch (err) {
            console.log(chalk.red('  Mic error: ' + err.message));
          }
        } else {
          console.log(chalk.gray('  (no mic — type your command)'));
        }
        ask();
        return;
      }

      // Built-in commands
      if (cmd === '.exit' || cmd === '.quit') {
        await engine.speak('Shutting down. Goodbye.');
        rl.close();
        process.exit(0);
      }

      if (cmd === '.tejas' || cmd === '.jarvis') {
        rl.close();
        await _tejasMode(engine, ai, router, memory, {});
        return;
      }

      if (cmd.startsWith('.speak ')) {
        await engine.speak(cmd.slice(7));
        ask();
        return;
      }

      if (cmd === '.status') {
        const stats = await memory.getGraphStats();
        const msg   = `System status: ${stats.total_nodes} knowledge nodes, ${stats.total_edges} connections.`;
        console.log(chalk.gray('  ' + msg));
        await engine.speak(msg);
        ask();
        return;
      }

      // Execute as Tejas task
      await _executeVoiceTask(cmd, engine, ai, router, memory);
      ask();
    });
  };

  ask();
}

// ─── JARVIS CONTINUOUS MODE ───────────────────────────────────────────────────
// Always listening for wake word
async function _tejasMode(engine, ai, router, memory, options) {
  if (!engine._sttAvailable) {
    display.error('Tejas mode requires speech-to-text.');
    display.br();
    console.log(chalk.bold('Install options:'));
    console.log('');
    console.log(chalk.cyan('Option 1 — Whisper (best quality):'));
    console.log(chalk.gray('  pip3 install openai-whisper --break-system-packages'));
    console.log(chalk.gray('  sudo apt install ffmpeg'));
    console.log('');
    console.log(chalk.cyan('Option 2 — Vosk (fully offline, fast):'));
    console.log(chalk.gray('  pip3 install vosk --break-system-packages'));
    console.log('');
    console.log(chalk.cyan('After installing, run:'));
    console.log(chalk.gray('  tejas voice --jarvis'));
    display.br();
    return;
  }

  console.log(chalk.bold.magenta('  ◈ TEJAS MODE — ACTIVE'));
  console.log(chalk.gray(`  Say "${engine.wakeWord}" to activate`));
  console.log(chalk.gray('  Press Ctrl+C to exit'));
  display.br();

  process.on('SIGINT', async () => {
    engine.stop();
    await engine.speak('Tejas offline. Goodbye.');
    display.br();
    process.exit(0);
  });

  await engine.startWakeWordLoop(async (command) => {
    await _executeVoiceTask(command, engine, ai, router, memory);
  });
}

// ─── LISTEN ONCE ─────────────────────────────────────────────────────────────
async function _listenOnce(engine, ai, router, memory) {
  if (!engine._sttAvailable) {
    display.error('No STT engine found. See: tejas voice --jarvis for install instructions.');
    return;
  }

  console.log(chalk.gray('  Listening...'));
  try {
    const heard = await engine.listenOnce(8000);
    if (!heard) { console.log(chalk.gray('  (nothing heard)')); return; }
    console.log(chalk.gray('  Heard: ') + chalk.white('"' + heard + '"'));
    await _executeVoiceTask(heard, engine, ai, router, memory);
  } catch (err) {
    display.error('Listen error: ' + err.message);
  }
}

// ─── EXECUTE VOICE TASK ───────────────────────────────────────────────────────
async function _executeVoiceTask(task, engine, ai, router, memory) {
  display.br();
  console.log(chalk.bold.cyan('  Task: ') + chalk.white(task));

  // Confirm task verbally
  if (engine._ttsAvailable) {
    await engine.speak(engine.getThinkingPhrase(), { mode: 'summary' });
  }

  // Route and execute
  const spin = display.spinner('Processing...').start();
  let result;

  try {
    const context = await memory.getContextSummary(task);
    const routing = await router.route(task, {}, context);

    if (!routing.useNativeExecutor && routing.result) {
      result = routing.result;
      spin.stop();

      if (result.success) {
        console.log(chalk.green('\n  ✓ ') + chalk.gray(routing.agent + ' agent'));
        display.br();

        // Print output
        if (result.output) {
          console.log(chalk.white(result.output.slice(0, 800)));
        }

        // Speak summary of result
        if (engine._ttsAvailable) {
          const summary = await _summarizeForSpeech(result.output, ai);
          await engine.speak(summary, { mode: 'summary', maxChars: 300 });
        }

      } else {
        console.log(chalk.red('\n  ✗ Failed: ') + result.error);
        if (engine._ttsAvailable) {
          await engine.speak(engine.getCompletionPhrase(task, false));
        }
      }

      // Log to memory
      await memory.logTask({
        task, agent: routing.agent, steps: 1,
        success: result.success, duration_ms: 0,
        error_message: result.error
      });

    } else {
      spin.stop();
      const msg = 'This task needs shell execution. Run it in the terminal with: tejas run ' + task;
      console.log(chalk.yellow('\n  ⚠ ' + msg));
      if (engine._ttsAvailable) await engine.speak(msg);
    }

  } catch (err) {
    spin.stop();
    console.log(chalk.red('\n  ✗ Error: ') + err.message);
    if (engine._ttsAvailable) {
      await engine.speak('I encountered an error. Please check the terminal.');
    }
  }

  display.br();
}

// ─── SUMMARIZE FOR SPEECH ─────────────────────────────────────────────────────
async function _summarizeForSpeech(output, ai) {
  if (!output || output.length < 100) return output || 'Done.';

  try {
    const prompt = `
Summarize this in 1-2 short spoken sentences for a voice assistant.
Be direct. No technical jargon. Sound like a calm, professional AI assistant.

Output:
${output.slice(0, 1000)}

Spoken summary (max 30 words):`;

    const summary = await ai.call(prompt);
    return summary.trim().slice(0, 200);
  } catch {
    return 'Task completed successfully.';
  }
}

const path = require('path');
// Use relative path for .env based on project root
const projectRoot = path.join(__dirname, '../..');
require('dotenv').config({ path: path.join(projectRoot, '.env') });

const TelegramBot = require('node-telegram-bot-api');
const { execFile } = require('child_process');
const fs = require('fs');

// 🔐 Token from .env
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN not found in .env");
  process.exit(1);
}

// 👤 Authorized IDs from .env (comma-separated string)
const AUTHORIZED_IDS = (process.env.TELEGRAM_AUTHORIZED_IDS || "")
  .split(',')
  .map(id => parseInt(id.trim()))
  .filter(id => !isNaN(id));

if (AUTHORIZED_IDS.length === 0) {
  console.warn("⚠️ WARNING: No TELEGRAM_AUTHORIZED_IDS found in .env. Bot will block all messages.");
}

console.log("🚀 Tejas Telegram Control: HARDENED VERSION STARTING...");

const bot = new TelegramBot(token, {
  polling: {
    interval: 500,
    autoStart: true,
    params: { timeout: 10 }
  }
});

const tejasBin = path.join(projectRoot, 'bin/tejas.js');

// Handle polling errors gracefully
bot.on('polling_error', (error) => {
  // Silent network errors
});

bot.on('error', (error) => {
  console.error(`❌ [General Error] ${error.message}`);
});

/**
 * Hardened execution: No shell interpolation.
 * Uses execFile with argument arrays.
 */
function runHardened(args, chatId) {
  const cmdDisplay = args.join(' ');
  console.log(`🛠️ Executing (Safe): ${cmdDisplay}`);
  bot.sendChatAction(chatId, 'typing');

  const options = {
    cwd: projectRoot,
    timeout: 60000
  };

  // Direct execution of the node binary with our script
  execFile('node', [tejasBin, ...args], options, (error, stdout, stderr) => {
    let output = (stdout || "").trim();
    let errorOutput = (stderr || "").trim();

    if (output) {
      bot.sendMessage(chatId, "✅\n" + output.slice(0, 4000));
    } else if (errorOutput) {
      bot.sendMessage(chatId, "❌ " + errorOutput.slice(0, 4000));
    } else if (error) {
      bot.sendMessage(chatId, "❌ Error: " + error.message);
    } else {
      bot.sendMessage(chatId, "⚡ Done (No output)");
    }
  });
}

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (!AUTHORIZED_IDS.includes(chatId)) {
    console.warn(`🛑 Unauthorized: ${chatId}`);
    bot.sendMessage(chatId, "❌ Unauthorized");
    return;
  }

  const input = text.trim();
  const lower = input.toLowerCase();

  // 1. Handle /start
  if (lower === '/start') {
    bot.sendMessage(chatId, "👋 Tejas Hardened Online.\n\n/status - System status\n/files - List files\n/memory - Memory graph\n/speak [text] - Voice output\n/run [task] - Execute task");
    return;
  }

  // 2. Fixed Command Map (Converted to args)
  if (lower === '/status') {
    runHardened(['status'], chatId);
    return;
  }
  if (lower === '/files') {
    // For general shell commands like 'ls', we route through 'tejas run' 
    // to benefit from the executor's internal sanitization and context.
    runHardened(['run', 'list all files in the current directory'], chatId);
    return;
  }
  if (lower === '/memory') {
    runHardened(['memory', '--show'], chatId);
    return;
  }

  // 3. Handle /speak
  if (lower.startsWith('/speak ')) {
    const speech = input.slice(7).trim();
    if (speech) {
      runHardened(['voice', '--speak', speech], chatId);
    } else {
      bot.sendMessage(chatId, "❌ Please provide text to speak.");
    }
    return;
  }

  // 4. Handle /run and Natural Language
  let task = input;
  if (lower.startsWith('/run ')) {
    task = input.slice(5).trim();
  }

  if (!task) {
    bot.sendMessage(chatId, "❌ Please provide a task.");
    return;
  }

  // Execute using the argument array to prevent shell injection
  runHardened(['run', task], chatId);
});

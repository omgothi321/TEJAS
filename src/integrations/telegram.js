require('dotenv').config({ path: '/home/kali/tejas/.env' });
const TelegramBot = require('node-telegram-bot-api');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// 🔐 Token from .env
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN not found in .env");
  process.exit(1);
}

// 👤 Authorized IDs
const AUTHORIZED_IDS = [1708700004, 8795252346, 8684802748];

console.log("🚀 Tejas Telegram Control: SOLID VERSION STARTING...");

const bot = new TelegramBot(token, {
  polling: {
    interval: 500,
    autoStart: true,
    params: { timeout: 10 }
  }
});

// Command Map for fixed actions
const commandMap = {
  '/status': '/home/kali/tejas/bin/tejas.js status',
  '/files': 'ls -p',
  '/memory': 'cat /home/kali/.tejas/memory.json'
};

// Handle polling errors gracefully
bot.on('polling_error', (error) => {
  // Silent network errors
});

bot.on('error', (error) => {
  console.error(`❌ [General Error] ${error.message}`);
});

function runClean(cmd, chatId) {
  console.log(`🛠️ Executing: ${cmd}`);
  bot.sendChatAction(chatId, 'typing');

  const options = {
    cwd: '/home/kali/tejas',
    timeout: 60000
  };

  // Using sh -c via execFile for the command map strings
  execFile('sh', ['-c', cmd], options, (error, stdout, stderr) => {
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

  const lower = text.trim().toLowerCase();

  // 1. Check Command Map
  if (commandMap[lower]) {
    runClean(commandMap[lower], chatId);
    return;
  }

  // 2. Handle /start
  if (lower === '/start') {
    bot.sendMessage(chatId, "👋 Tejas Solid Online.\n\n/status - System status\n/files - List files\n/memory - Memory graph\n/speak [text] - Voice output\n/run [task] - Execute task");
    return;
  }

  // 3. Handle specific commands with args
  if (lower.startsWith('/speak ')) {
    const speech = text.slice(7).trim();
    if (speech) {
      runClean(`/home/kali/tejas/bin/tejas.js voice --speak "${speech}"`, chatId);
    } else {
      bot.sendMessage(chatId, "❌ Please provide text to speak.");
    }
    return;
  }

  // 4. Handle /run and Natural Language
  let task = text;
  if (lower.startsWith('/run ')) {
    task = text.slice(5).trim();
  }

  if (!task) {
    bot.sendMessage(chatId, "❌ Please provide a task.");
    return;
  }

  // Execute directly without "echo y" - Note: Requires non-interactive mode or --yes in CLI
  runClean(`/home/kali/tejas/bin/tejas.js run "${task}"`, chatId);
});

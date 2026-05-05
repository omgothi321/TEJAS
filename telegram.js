const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// 🔐 Your Bot Token (From existing file)
const token = "6207870347:AAGHXPeexKw0EcTW-Zd9ZefVNiVj4zMcfqo";

// 👤 Authorized IDs
const AUTHORIZED_IDS = [1708700004, 8795252346];

console.log("🚀 Tejas Telegram Control Starting...");

// 🧹 Clean Pkill: Ensure no duplicate instances
exec('pkill -f "node speak.js" || pkill -f "node telegram.js" || true');

const bot = new TelegramBot(token, {
  polling: {
    interval: 500,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Handle polling errors gracefully (False errors fix)
bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' || error.message.includes('EFATAL')) {
    console.warn(`⚠️ [Network/Polling] ${error.code}: ${error.message}`);
  } else {
    // Suppress common transient errors to avoid terminal spam
  }
});

bot.on('error', (error) => {
  console.error(`❌ [General Error] ${error.message}`);
});

// Helper to run shell commands
function runShell(cmd, chatId) {
  console.log(`🛠️ Executing: ${cmd}`);
  bot.sendChatAction(chatId, 'typing');
  exec(cmd, {
    cwd: '/home/kali/tejas',
    timeout: 60000
  }, (error, stdout, stderr) => {
    let output = (stdout || "").trim();
    let errorOutput = (stderr || "").trim();

    console.log(`✅ Stdout: ${output.slice(0, 100)}...`);
    if (error) console.log(`❌ Error: ${error.message}`);

    if (output.length > 0) {
      bot.sendMessage(chatId, "✅\n" + output.slice(0, 4000));
    } else if (errorOutput.length > 0 && error) {
      bot.sendMessage(chatId, "❌ " + errorOutput.slice(0, 4000));
    } else if (error) {
      bot.sendMessage(chatId, "❌ Error: " + error.message);
    } else {
      bot.sendMessage(chatId, "⚡ Done (No output)");
    }
  });
}

// Handle messages
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  console.log(`📩 Message from ${chatId}: ${text}`);

  // 🔒 Security check
  if (!AUTHORIZED_IDS.includes(chatId)) {
    bot.sendMessage(chatId, "❌ Unauthorized access");
    return;
  }

  if (!text) return;

  // Handle slash commands
  if (text.startsWith('/')) {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case '/start':
        bot.sendMessage(chatId, `👋 Welcome Sir. Tejas is online and ready.

/status - Check system status
/files - List files
/memory - Show learned memory
/run [task] - Execute a task
/speak [text] - Speak text`);
        return;
      case '/status':
        runShell('/home/kali/tejas/bin/tejas.js status', chatId);
        return;
      case '/files':
        runShell('ls -p | grep -v / | head -20', chatId);
        return;
      case '/memory':
        runShell('cat /home/kali/.tejas/memory.json | jq "."', chatId);
        return;
      case '/run':
        if (!args) {
          bot.sendMessage(chatId, "❌ Please provide a task. Example: /run what time is it?");
          return;
        }
        runShell(`echo "y" | /home/kali/tejas/bin/tejas.js run "${args}"`, chatId);
        return;
      case '/speak':
        if (!args) {
          bot.sendMessage(chatId, "❌ Please provide text to speak.");
          return;
        }
        runShell(`/home/kali/tejas/bin/tejas.js voice --speak "${args}"`, chatId);
        return;
      default:
        bot.sendMessage(chatId, "❓ Unknown command: " + command);
        return;
    }
  }

  // Handle natural language (fallback)
  const commandsPath = '/home/kali/tejas/commands.json';
  let commands = {};
  if (fs.existsSync(commandsPath)) {
    try {
      commands = JSON.parse(fs.readFileSync(commandsPath));
    } catch (e) {
      console.error("Error parsing commands.json");
    }
  }

  let input = text.toLowerCase().trim();
  let cmdToRun = commands[input] ? commands[input] : `echo "y" | /home/kali/tejas/bin/tejas.js run "${text}"`;

  runShell(cmdToRun, chatId);
});

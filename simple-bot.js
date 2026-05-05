const TelegramBot = require('node-telegram-bot-api');
const token = "6207870347:AAGHXPeexKw0EcTW-Zd9ZefVNiVj4zMcfqo";
const bot = new TelegramBot(token, { polling: true });

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  console.log(`📩 Received: ${text} from ${chatId}`);
  bot.sendMessage(chatId, `✅ Received: ${text}`);
});

console.log('🚀 Simple Bot Started...');

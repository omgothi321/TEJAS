const TelegramBot = require('node-telegram-bot-api');
const token = "6207870347:AAGHXPeexKw0EcTW-Zd9ZefVNiVj4zMcfqo";
const bot = new TelegramBot(token, { polling: true });

bot.getMe().then((me) => {
  console.log(`🤖 Bot Name: ${me.first_name}`);
  console.log(`🤖 Bot Username: @${me.username}`);
  process.exit(0);
}).catch((err) => {
  console.error(`❌ Connection Error: ${err.message}`);
  process.exit(1);
});

const express = require('express');
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Ошибка обработки обновления:', err);
    res.sendStatus(500);
  }
});

bot.start((ctx) => {
  ctx.reply('🧠 Добро пожаловать в NEURON! Игра, где твой ум приносит токены. Скоро запуск!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Бот запущен на порту ${PORT}`);
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  if (WEBHOOK_URL) {
    await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook/${BOT_TOKEN}`);
    console.log('Вебхук установлен:', WEBHOOK_URL);
  } else {
    console.warn('WEBHOOK_URL не задан, вебхук не установлен');
  }
});

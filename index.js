const express = require('express');
const { Telegraf } = require('telegraf');

const BOT_TOKEN = '8689023992:AAF_xjJkg0MUW3zmitwvRh85RuvBdeeA0Kc';
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
  res.sendStatus(200);
});

bot.start((ctx) => {
  ctx.reply('🧠 Добро пожаловать в NEURON! Игра, где твой ум приносит токены. Скоро запуск!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Бот запущен на порту ${PORT}`);
});

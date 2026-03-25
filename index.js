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

// Множество для отслеживания пользователей, уже ответивших
const answeredUsers = new Set();

bot.start((ctx) => {
  ctx.reply('🧠 Добро пожаловать в NEURON! Игра, где твой ум приносит токены.', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 Играть', callback_data: 'play' }]
      ]
    }
  });
});

bot.action('play', async (ctx) => {
  await ctx.answerCbQuery();
  answeredUsers.delete(ctx.from.id);
  await ctx.reply('Скоро начнётся викторина. А пока — первый вопрос:');
  await ctx.reply('Какой язык используется для смарт-контрактов в Ethereum?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'JavaScript', callback_data: 'answer_wrong_javascript' },
          { text: 'Solidity', callback_data: 'answer_correct_solidity' }
        ],
        [
          { text: 'Python', callback_data: 'answer_wrong_python' },
          { text: 'C++', callback_data: 'answer_wrong_cpp' }
        ]
      ]
    }
  });
});

bot.action(/^answer_(correct|wrong)_\w+$/, async (ctx) => {
  if (answeredUsers.has(ctx.from.id)) {
    await ctx.answerCbQuery('Вы уже ответили на этот вопрос!', { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();
  answeredUsers.add(ctx.from.id);
  const isCorrect = ctx.match[1] === 'correct';
  if (isCorrect) {
    await ctx.reply('✅ Правильно! Вы получаете 10 токенов NEURON.');
    // Здесь потом начислим токены
  } else {
    await ctx.reply('❌ Неправильно. Правильный ответ: Solidity.');
  }
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

const express = require('express');
const path = require('path');
const fs = require('fs');
const { Telegraf } = require('telegraf');

// === Переменные окружения ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBAPP_URL = process.env.WEBAPP_URL;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// === CORS для Mini App ===
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// === Отдача мини-аппа (если файл index.html есть в корне) ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// === Сохранение прогресса в файл ===
const PROGRESS_FILE = './progress.json';

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveProgress() {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(playerProgress), 'utf8');
  } catch (e) {}
}

let playerProgress = loadProgress();

// === Keep-alive пинг каждые 5 минут ===
setInterval(() => {
  const http = require('http');
  http.get(`http://localhost:${process.env.PORT || 3000}/`).on('error', () => {});
}, 5 * 60 * 1000);

// === База вопросов ===
const questions = [
  {
    text: "Какой язык используется для смарт-контрактов в Ethereum?",
    options: ["JavaScript", "Solidity", "Python", "C++"],
    correct: "Solidity"
  },
  {
    text: "Что такое блокчейн?",
    options: ["Распределённая база данных", "Централизованный сервер", "Язык программирования", "Криптовалюта"],
    correct: "Распределённая база данных"
  },
  {
    text: "Кто создал Биткоин?",
    options: ["Виталик Бутерин", "Сатоши Накамото", "Илон Маск", "Чарльз Хоскинсон"],
    correct: "Сатоши Накамото"
  },
  {
    text: "Что такое NFT?",
    options: ["Незаменяемый токен", "Новая финансовая технология", "Сетевая файловая система", "Биржевой фонд"],
    correct: "Незаменяемый токен"
  },
  {
    text: "Что означает PoW (Proof of Work)?",
    options: ["Подтверждение доли", "Подтверждение работы", "Подтверждение транзакции", "Подтверждение владения"],
    correct: "Подтверждение работы"
  }
];

// === API для Mini App ===

app.get('/api/question', (req, res) => {
  const userId = req.query.user_id || 'anonymous';
  if (!playerProgress[userId]) {
    playerProgress[userId] = { currentIndex: 0, score: 0 };
  }
  const { currentIndex, score } = playerProgress[userId];
  if (currentIndex >= questions.length) {
    return res.json({ finished: true, total: questions.length, score });
  }
  const q = questions[currentIndex];
  res.json({
    text: q.text,
    options: q.options,
    index: currentIndex,
    total: questions.length,
    score
  });
});

app.post('/api/answer', (req, res) => {
  const { user_id, answer } = req.body;
  const userId = user_id || 'anonymous';

  // Сброс прогресса (кнопка "Играть снова")
  if (answer === 'reset') {
    playerProgress[userId] = { currentIndex: 0, score: 0 };
    saveProgress();
    return res.json({ reset: true });
  }

  if (!playerProgress[userId]) {
    playerProgress[userId] = { currentIndex: 0, score: 0 };
  }

  const { currentIndex, score } = playerProgress[userId];
  if (currentIndex >= questions.length) {
    return res.json({ finished: true, total: questions.length, score });
  }

  const q = questions[currentIndex];
  const isCorrect = answer === q.correct;
  let newScore = score;
  if (isCorrect) newScore += 10;
  const newIndex = currentIndex + 1;
  playerProgress[userId] = { currentIndex: newIndex, score: newScore };
  saveProgress();

  let message = isCorrect
    ? `✅ Правильно! +10 токенов. Всего: ${newScore}`
    : `❌ Неправильно. Правильный ответ: ${q.correct}.`;
  const finished = newIndex >= questions.length;
  if (finished) {
    message += `\n\n🎉 Викторина завершена! Вы набрали ${newScore} токенов.`;
  }

  const response = {
    correct: isCorrect,
    finished,
    score: newScore,
    message,
    total: questions.length
  };

  if (!finished) {
    const nextQ = questions[newIndex];
    response.nextQuestion = {
      text: nextQ.text,
      options: nextQ.options
    };
    response.nextIndex = newIndex;
  }

  res.json(response);
});

// === Вебхук Telegram ===
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Ошибка обработки обновления:', err);
    res.sendStatus(500);
  }
});

// === Команды бота ===
bot.start((ctx) => {
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎮 Текстовая викторина', callback_data: 'play_text' }]
    ]
  };
  if (WEBAPP_URL) {
    keyboard.inline_keyboard.push([{ text: '🕹️ Играть в Mini App', web_app: { url: WEBAPP_URL } }]);
  }
  ctx.reply('🧠 Добро пожаловать в NEURON! Игра, где твой ум приносит токены.', {
    reply_markup: keyboard
  });
});

bot.action('play_text', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  playerProgress[userId] = { currentIndex: 0, score: 0 };
  saveProgress();
  await askQuestion(ctx, userId);
});

async function askQuestion(ctx, userId) {
  const prog = playerProgress[userId];
  if (!prog || prog.currentIndex >= questions.length) {
    const score = prog ? prog.score : 0;
    await ctx.reply(`🎉 Викторина завершена! Вы набрали ${score} токенов.`);
    delete playerProgress[userId];
    saveProgress();
    return;
  }
  const q = questions[prog.currentIndex];
  const rows = [];
  for (let i = 0; i < q.options.length; i += 2) {
    const row = [{ text: q.options[i], callback_data: `ta_${i}` }];
    if (i + 1 < q.options.length) {
      row.push({ text: q.options[i + 1], callback_data: `ta_${i + 1}` });
    }
    rows.push(row);
  }
  await ctx.reply(`Вопрос ${prog.currentIndex + 1}/${questions.length}: ${q.text}`, {
    reply_markup: { inline_keyboard: rows }
  });
}

bot.action(/ta_(\d+)/, async (ctx) => {
  const userId = ctx.from.id;
  const optionIndex = parseInt(ctx.match[1]);
  const prog = playerProgress[userId];
  if (!prog || prog.currentIndex >= questions.length) {
    await ctx.answerCbQuery('Игра завершена. Начните заново /start');
    return;
  }
  const q = questions[prog.currentIndex];
  const selected = q.options[optionIndex];
  const isCorrect = selected === q.correct;
  if (isCorrect) prog.score += 10;
  prog.currentIndex++;
  saveProgress();
  await ctx.answerCbQuery();
  const msg = isCorrect
    ? `✅ Правильно! +10 токенов. Всего: ${prog.score}`
    : `❌ Неправильно. Правильный ответ: ${q.correct}`;
  await ctx.reply(msg);
  if (prog.currentIndex < questions.length) {
    await askQuestion(ctx, userId);
  } else {
    await ctx.reply(`🎉 Викторина завершена! Вы набрали ${prog.score} токенов.`);
    delete playerProgress[userId];
    saveProgress();
  }
});

// === Запуск сервера ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  if (WEBHOOK_URL) {
    await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook/${BOT_TOKEN}`);
    console.log(`Вебхук установлен: ${WEBHOOK_URL}/webhook/${BOT_TOKEN}`);
  } else {
    console.warn('WEBHOOK_URL не задан, вебхук не установлен');
  }
});

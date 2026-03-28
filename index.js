const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');

// === Логирование ошибок ===
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

// === Переменные окружения ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set');
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.warn('WEBHOOK_URL is not set, webhook will not be set automatically');
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// === Логирование всех запросов ===
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// === CORS для Mini App ===
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// === Отдача мини-аппа ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// === Пути для сохранения (используем DATA_DIR от Bothost) ===
const DATA_DIR = process.env.DATA_DIR || '.';
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveProgress() {
  fs.writeFile(PROGRESS_FILE, JSON.stringify(playerProgress), 'utf8', (err) => {
    if (err) console.error('Ошибка сохранения прогресса:', err);
  });
}

function loadQuestions() {
  try {
    if (fs.existsSync(QUESTIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {}
  return null;
}

function saveQuestions() {
  fs.writeFile(QUESTIONS_FILE, JSON.stringify(questions, null, 2), 'utf8', (err) => {
    if (err) console.error('Ошибка сохранения вопросов:', err);
  });
}

let playerProgress = loadProgress();

// === База вопросов (загружается из файла, иначе дефолтные) ===
const DEFAULT_QUESTIONS = [
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
let questions = loadQuestions() || DEFAULT_QUESTIONS;

// === Функция проверки Telegram initData ===
function verifyTelegramInitData(initData, botToken) {
  if (!initData) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return computedHash === hash;
}

// === Middleware для проверки initData ===
function requireInitData(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!verifyTelegramInitData(initData, BOT_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// === API для Mini App (требуют авторизации) ===
app.get('/api/question', requireInitData, (req, res) => {
  const userId = req.query.user_id || 'anonymous';
  if (!playerProgress[userId]) {
    playerProgress[userId] = {
      currentIndex: 0,
      score: 0,
      totalScore: 0,
      gamesPlayed: 0,
      hintsUsed: [],
      name: req.query.name || 'Игрок'
    };
  }
  const { currentIndex, score, totalScore, hintsUsed } = playerProgress[userId];
  if (currentIndex >= questions.length) {
    return res.json({ finished: true, total: questions.length, score, totalScore, hintsUsed });
  }
  const q = questions[currentIndex];
  res.json({
    text: q.text,
    options: q.options,
    index: currentIndex,
    total: questions.length,
    score,
    totalScore: totalScore || 0,
    hintsUsed: hintsUsed || []
  });
});

app.post('/api/answer', requireInitData, (req, res) => {
  const { user_id, answer, name } = req.body;
  const userId = user_id || 'anonymous';

  if (answer === 'reset') {
    const prev = playerProgress[userId] || {};
    playerProgress[userId] = {
      currentIndex: 0,
      score: 0,
      totalScore: prev.totalScore || 0,
      gamesPlayed: prev.gamesPlayed || 0,
      hintsUsed: [],
      name: prev.name || name || 'Игрок'
    };
    saveProgress();
    return res.json({ reset: true });
  }

  if (!playerProgress[userId]) {
    playerProgress[userId] = {
      currentIndex: 0,
      score: 0,
      totalScore: 0,
      gamesPlayed: 0,
      hintsUsed: [],
      name: name || 'Игрок'
    };
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
  const isFinished = newIndex >= questions.length;

  const prev = playerProgress[userId];
  playerProgress[userId] = {
    currentIndex: newIndex,
    score: newScore,
    totalScore: (prev.totalScore || 0) + (isFinished ? newScore : 0),
    gamesPlayed: (prev.gamesPlayed || 0) + (isFinished ? 1 : 0),
    hintsUsed: prev.hintsUsed || [],
    name: name || prev.name || 'Игрок'
  };
  saveProgress();

  let message = isCorrect
    ? `✅ Правильно! +10 токенов. Всего: ${newScore}`
    : `❌ Неправильно. Правильный ответ: ${q.correct}.`;
  if (isFinished) {
    message += `\n\n🎉 Викторина завершена! Вы набрали ${newScore} токенов.`;
  }

  const response = {
    correct: isCorrect,
    finished: isFinished,
    score: newScore,
    message,
    total: questions.length
  };

  if (!isFinished) {
    const nextQ = questions[newIndex];
    response.nextQuestion = {
      text: nextQ.text,
      options: nextQ.options
    };
    response.nextIndex = newIndex;
  }

  res.json(response);
});

app.get('/api/leaderboard', requireInitData, (req, res) => {
  const userId = req.query.user_id;
  const all = Object.entries(playerProgress)
    .map(([id, p]) => ({
      id,
      name: p.name || 'Игрок',
      totalScore: p.totalScore || 0,
      gamesPlayed: p.gamesPlayed || 0
    }))
    .sort((a, b) => b.totalScore - a.totalScore);
  const top10 = all.slice(0, 10);
  const myRank = all.findIndex(p => String(p.id) === String(userId)) + 1;
  const me = all.find(p => String(p.id) === String(userId)) || null;
  res.json({ top10, myRank, me });
});

// === Админ-панель (без авторизации, но с паролем) ===
function checkAdmin(req, res) {
  const auth = req.headers['x-admin-password'];
  if (!auth || auth !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Неверный пароль' });
    return false;
  }
  return true;
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/stats', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const players = Object.entries(playerProgress).map(([id, p]) => ({
    id,
    name: p.name || 'Игрок',
    totalScore: p.totalScore || 0,
    gamesPlayed: p.gamesPlayed || 0,
    currentIndex: p.currentIndex || 0,
    score: p.score || 0
  })).sort((a, b) => b.totalScore - a.totalScore);
  res.json({ players, totalPlayers: players.length });
});

app.get('/api/admin/questions', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(questions);
});

app.post('/api/admin/questions/add', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { text, options, correct } = req.body;
  if (!text || !options || !correct) return res.status(400).json({ error: 'Неверные данные' });
  questions.push({ text, options, correct });
  saveQuestions();
  res.json({ ok: true, total: questions.length });
});

app.post('/api/admin/questions/delete', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { index } = req.body;
  if (index < 0 || index >= questions.length) return res.status(400).json({ error: 'Неверный индекс' });
  questions.splice(index, 1);
  saveQuestions();
  res.json({ ok: true, total: questions.length });
});

app.post('/api/admin/reset-player', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { userId } = req.body;
  if (playerProgress[userId]) {
    playerProgress[userId] = {
      currentIndex: 0,
      score: 0,
      totalScore: 0,
      gamesPlayed: 0,
      hintsUsed: [],
      name: playerProgress[userId].name || 'Игрок'
    };
    saveProgress();
  }
  res.json({ ok: true });
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
  playerProgress[userId] = {
    currentIndex: 0,
    score: 0,
    totalScore: 0,
    gamesPlayed: 0,
    hintsUsed: [],
    name: ctx.from.first_name || 'Игрок'
  };
  saveProgress();
  await askQuestion(ctx, userId);
});

async function askQuestion(ctx, userId) {
  try {
    const prog = playerProgress[userId];
    if (!prog || prog.currentIndex >= questions.length) {
      const score = prog ? prog.score : 0;
      await ctx.reply(`🎉 Викторина завершена! Вы набрали ${score} токенов.`);
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
  } catch (err) {
    console.error('Ошибка отправки вопроса:', err.message);
  }
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
  const isFinished = prog.currentIndex >= questions.length;
  if (isFinished) {
    prog.totalScore = (prog.totalScore || 0) + prog.score;
    prog.gamesPlayed = (prog.gamesPlayed || 0) + 1;
  }
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
  }
});

// === Подсказки ===
app.post('/api/use-hint', requireInitData, (req, res) => {
  const { user_id, hint } = req.body;
  const userId = user_id || 'anonymous';
  const prog = playerProgress[userId];
  if (!prog) {
    return res.status(400).json({ error: 'Игрок не найден' });
  }
  if (prog.currentIndex >= questions.length) {
    return res.status(400).json({ error: 'Викторина уже завершена' });
  }

  // Проверяем, не использовалась ли уже эта подсказка
  if (!prog.hintsUsed) prog.hintsUsed = [];
  if (prog.hintsUsed.includes(hint)) {
    return res.status(400).json({ error: 'Эта подсказка уже использована в этой игре' });
  }

  let cost = 0;
  if (hint === '5050') cost = 5;
  else if (hint === 'replace') cost = 10;
  else return res.status(400).json({ error: 'Неизвестная подсказка' });

  if (prog.totalScore < cost) {
    return res.status(400).json({ error: `Недостаточно токенов. Нужно ${cost}` });
  }

  if (hint === '5050') {
    const currentIndex = prog.currentIndex;
    const q = questions[currentIndex];
    const options = q.options;
    const correct = q.correct;
    const wrongIndices = options.reduce((acc, opt, idx) => {
      if (opt !== correct) acc.push(idx);
      return acc;
    }, []);
    const shuffled = wrongIndices.sort(() => 0.5 - Math.random());
    const removedIndices = shuffled.slice(0, 2);
    prog.totalScore -= cost;
    prog.hintsUsed.push(hint);
    saveProgress();
    return res.json({ removedIndices, newScore: prog.totalScore });
  } else if (hint === 'replace') {
    // Выбираем другой вопрос
    let newIdx = prog.currentIndex;
    if (questions.length > 1) {
      do {
        newIdx = Math.floor(Math.random() * questions.length);
      } while (newIdx === prog.currentIndex);
    }
    const newQuestion = questions[newIdx];
    prog.currentIndex = newIdx;
    prog.totalScore -= cost;
    prog.hintsUsed.push(hint);
    saveProgress();
    return res.json({
      newQuestion: { text: newQuestion.text, options: newQuestion.options },
      newScore: prog.totalScore
    });
  }
});

// === Webhook маршрут ===
const WEBHOOK_PATH = '/webhook';
app.post(WEBHOOK_PATH, (req, res) => {
  res.sendStatus(200);
  bot.handleUpdate(req.body).catch(err => console.error('Ошибка обработки обновления:', err));
});

// === Запуск сервера ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  if (WEBHOOK_URL) {
    try {
      await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
      console.log(`Вебхук установлен: ${WEBHOOK_URL}${WEBHOOK_PATH}`);
    } catch (err) {
      console.error('Ошибка установки вебхука:', err.message);
    }
  } else {
    console.warn('WEBHOOK_URL не задан, вебхук не установлен');
  }
});

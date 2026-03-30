const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set');
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.warn('WEBHOOK_URL is not set');
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

app.get('/tonconnect-manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    url: "https://neuronl.bothost.tech",
    name: "NEURON Game",
    iconUrl: "https://neuronl.bothost.tech/icon.png"
  });
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const DATA_DIR = process.env.DATA_DIR || '.';
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function saveProgress() {
  fs.writeFile(PROGRESS_FILE, JSON.stringify(playerProgress), 'utf8', (err) => {
    if (err) console.error('Ошибка сохранения:', err);
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

// === Rate limiting ===
const requestLog = new Map();
function rateLimiter(maxReq, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const log = (requestLog.get(ip) || []).filter(t => t > now - windowMs);
    log.push(now);
    requestLog.set(ip, log);
    if (log.length > maxReq) {
      return res.status(429).json({ error: 'Слишком много запросов. Притормози!' });
    }
    next();
  };
}
// Очистка памяти каждые 5 минут
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [ip, times] of requestLog.entries()) {
    const fresh = times.filter(t => t > cutoff);
    if (fresh.length === 0) requestLog.delete(ip);
    else requestLog.set(ip, fresh);
  }
}, 300000);

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
  },
  {
    text: "Что такое DeFi?",
    options: ["Децентрализованные финансы", "Цифровые финансы", "Безопасные финансы", "Быстрые финансы"],
    correct: "Децентрализованные финансы"
  },
  {
    text: "Что такое газ в Ethereum?",
    options: ["Комиссия за транзакцию", "Вид криптовалюты", "Тип кошелька", "Протокол безопасности"],
    correct: "Комиссия за транзакцию"
  },
  {
    text: "Что такое приватный ключ?",
    options: ["Секретный код для доступа к кошельку", "Публичный адрес кошелька", "Вид токена", "Пароль от биржи"],
    correct: "Секретный код для доступа к кошельку"
  },
  {
    text: "Что такое стейкинг?",
    options: ["Блокировка токенов для получения награды", "Продажа токенов", "Обмен токенов", "Хранение токенов на бирже"],
    correct: "Блокировка токенов для получения награды"
  },
  {
    text: "Что такое seed-фраза?",
    options: ["Набор слов для восстановления кошелька", "Пароль от биржи", "Адрес кошелька", "Вид смарт-контракта"],
    correct: "Набор слов для восстановления кошелька"
  }
];
let questions = loadQuestions() || DEFAULT_QUESTIONS;

const QUESTIONS_PER_GAME = 10;
const MAX_FREE_GAMES_PER_DAY = 5;
const TOKENS_PER_QUESTION_FREE = 1;

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function checkDailyLimit(prog) {
  const today = todayStr();
  if (prog.lastPlayDate !== today) {
    prog.lastPlayDate = today;
    prog.gamesPlayedToday = 0;
  }
  return prog.gamesPlayedToday || 0;
}

function pickGameQuestions() {
  const pool = [...Array(questions.length).keys()];
  const shuffled = shuffleArray(pool);
  return shuffled.slice(0, Math.min(QUESTIONS_PER_GAME, questions.length));
}

function verifyTelegramInitData(initData, botToken) {
  if (!initData) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  const authDate = parseInt(params.get('auth_date') || '0');
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) return false;
  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return computedHash === hash;
}

function requireInitData(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (initData && verifyTelegramInitData(initData, BOT_TOKEN)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/api/question', rateLimiter(30, 60000), requireInitData, (req, res) => {
  const userId = req.query.user_id || 'anonymous';
  if (!playerProgress[userId]) {
    playerProgress[userId] = {
      currentIndex: 0,
      score: 0,
      totalScore: 0,
      gamesPlayed: 0,
      gamesPlayedToday: 0,
      lastPlayDate: todayStr(),
      hintsUsed: [],
      questionOrder: pickGameQuestions(),
      name: req.query.name || 'Игрок',
      questionStartTime: 0
    };
  }
  const prog = playerProgress[userId];
  const gamesPlayedToday = checkDailyLimit(prog);
  const freeGamesLeft = Math.max(0, MAX_FREE_GAMES_PER_DAY - gamesPlayedToday);

  const qIndex = prog.questionOrder[prog.currentIndex];
  if (qIndex === undefined || !questions[qIndex]) {
    prog.currentIndex = 0;
    prog.questionOrder = pickGameQuestions();
    prog.score = 0;
    prog.hintsUsed = [];
    saveProgress();
  }

  if (prog.currentIndex > 0 && prog.currentIndex < QUESTIONS_PER_GAME) {
    const q = questions[prog.questionOrder[prog.currentIndex]];
    prog.questionStartTime = Date.now();
    saveProgress();
    return res.json({
      text: q.text,
      options: q.options,
      index: prog.currentIndex,
      total: QUESTIONS_PER_GAME,
      score: prog.score,
      totalScore: prog.totalScore || 0,
      hintsUsed: prog.hintsUsed || [],
      gamesPlayed: prog.gamesPlayed || 0,
      freeGamesLeft
    });
  }

  if (prog.currentIndex >= QUESTIONS_PER_GAME) {
    return res.json({
      finished: true,
      score: prog.score,
      totalScore: prog.totalScore,
      gamesPlayed: prog.gamesPlayed,
      freeGamesLeft
    });
  }

  if (freeGamesLeft <= 0) {
    return res.json({
      finished: true,
      noGamesLeft: true,
      score: 0,
      totalScore: prog.totalScore,
      gamesPlayed: prog.gamesPlayed,
      freeGamesLeft: 0
    });
  }

  const firstQIndex = prog.questionOrder[0];
  if (firstQIndex === undefined || !questions[firstQIndex]) {
    return res.json({
      finished: true,
      score: 0,
      totalScore: prog.totalScore || 0,
      gamesPlayed: prog.gamesPlayed || 0,
      freeGamesLeft
    });
  }
  const q = questions[firstQIndex];
  prog.questionStartTime = Date.now();
  saveProgress();
  res.json({
    text: q.text,
    options: q.options,
    index: 0,
    total: QUESTIONS_PER_GAME,
    score: prog.score,
    totalScore: prog.totalScore || 0,
    hintsUsed: [],
    gamesPlayed: prog.gamesPlayed || 0,
    freeGamesLeft
  });
});

app.post('/api/answer', rateLimiter(30, 60000), requireInitData, (req, res) => {
  const { user_id, answer, name } = req.body;
  const userId = user_id || 'anonymous';

  if (answer === 'reset') {
    const prev = playerProgress[userId] || {};
    checkDailyLimit(prev);
    const freeGamesLeft = Math.max(0, MAX_FREE_GAMES_PER_DAY - (prev.gamesPlayedToday || 0));
    if (freeGamesLeft <= 0) {
      return res.json({ noGamesLeft: true, freeGamesLeft: 0, totalScore: prev.totalScore || 0 });
    }
    playerProgress[userId] = {
      totalScore: 0,
      gamesPlayed: 0,
      gamesPlayedToday: 0,
      lastPlayDate: todayStr(),
      ...prev,
      currentIndex: 0,
      score: 0,
      hintsUsed: [],
      questionOrder: pickGameQuestions(),
      name: prev.name || name || 'Игрок',
      questionStartTime: 0
    };
    saveProgress();
    return res.json({ reset: true, freeGamesLeft });
  }

  if (!playerProgress[userId]) {
    playerProgress[userId] = {
      currentIndex: 0,
      score: 0,
      totalScore: 0,
      gamesPlayed: 0,
      gamesPlayedToday: 0,
      lastPlayDate: todayStr(),
      hintsUsed: [],
      questionOrder: pickGameQuestions(),
      name: name || 'Игрок',
      questionStartTime: 0
    };
  }

  const prog = playerProgress[userId];
  checkDailyLimit(prog);

  if (prog.currentIndex >= QUESTIONS_PER_GAME) {
    return res.json({ finished: true, score: prog.score, totalScore: prog.totalScore });
  }

  const elapsed = Date.now() - (prog.questionStartTime || 0);
  if (elapsed < 2000) {
    return res.status(400).json({ error: 'Слишком быстро! Прочитай вопрос.' });
  }

  const q = questions[prog.questionOrder[prog.currentIndex]];
  if (!q) {
    prog.currentIndex = 0;
    prog.questionOrder = pickGameQuestions();
    prog.score = 0;
    prog.hintsUsed = [];
    saveProgress();
    return res.json({
      finished: true,
      score: 0,
      totalScore: prog.totalScore,
      gamesPlayed: prog.gamesPlayed,
      freeGamesLeft: Math.max(0, MAX_FREE_GAMES_PER_DAY - (prog.gamesPlayedToday || 0))
    });
  }

  const isCorrect = answer === q.correct;
  const correctIndex = q.options.findIndex(opt => opt === q.correct);

  if (isCorrect) prog.score += TOKENS_PER_QUESTION_FREE;
  prog.currentIndex += 1;
  const isFinished = prog.currentIndex >= QUESTIONS_PER_GAME || prog.currentIndex >= prog.questionOrder.length;

  if (isFinished) {
    prog.totalScore = (prog.totalScore || 0) + prog.score;
    prog.gamesPlayed = (prog.gamesPlayed || 0) + 1;
    prog.gamesPlayedToday = (prog.gamesPlayedToday || 0) + 1;
  }

  if (!isFinished) {
    prog.questionStartTime = Date.now();
  }
  saveProgress();

  const freeGamesLeft = Math.max(0, MAX_FREE_GAMES_PER_DAY - (prog.gamesPlayedToday || 0));

  let message = isCorrect
    ? `✅ Правильно! +${TOKENS_PER_QUESTION_FREE} токен. Счёт: ${prog.score}`
    : `❌ Неправильно. Правильный ответ: ${q.correct}.`;

  if (isFinished) message += `\n\n🎉 Игра завершена! Ты набрал ${prog.score} токенов.`;

  const response = {
    correct: isCorrect,
    correctIndex,
    finished: isFinished,
    score: prog.score,
    totalScore: prog.totalScore,
    gamesPlayed: prog.gamesPlayed,
    freeGamesLeft,
    message,
    total: QUESTIONS_PER_GAME
  };

  if (!isFinished) {
    const nextQ = questions[prog.questionOrder[prog.currentIndex]];
    if (nextQ) {
      response.nextQuestion = {
        text: nextQ.text,
        options: nextQ.options
      };
      response.nextIndex = prog.currentIndex;
    } else {
      response.finished = true;
    }
  }

  res.json(response);
});

app.get('/api/leaderboard', rateLimiter(30, 60000), requireInitData, (req, res) => {
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
    gamesPlayedToday: p.gamesPlayedToday || 0,
    currentScore: p.score || 0
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
      gamesPlayedToday: 0,
      lastPlayDate: todayStr(),
      hintsUsed: [],
      questionOrder: pickGameQuestions(),
      name: playerProgress[userId].name || 'Игрок',
      questionStartTime: 0
    };
    saveProgress();
  }
  res.json({ ok: true });
});

app.post('/api/admin/delete-player', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { userId } = req.body;
  if (playerProgress[userId]) {
    delete playerProgress[userId];
    saveProgress();
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Игрок не найден' });
  }
});

app.post('/api/use-hint', rateLimiter(20, 60000), requireInitData, (req, res) => {
  const { user_id, hint } = req.body;
  const userId = user_id || 'anonymous';
  const prog = playerProgress[userId];
  if (!prog) return res.status(400).json({ error: 'Игрок не найден' });
  if (prog.currentIndex >= QUESTIONS_PER_GAME) return res.status(400).json({ error: 'Викторина завершена' });

  if (!prog.hintsUsed) prog.hintsUsed = [];
  if (prog.hintsUsed.includes(hint)) return res.status(400).json({ error: 'Подсказка уже использована' });

  let cost = 0;
  if (hint === '5050') cost = 5;
  else if (hint === 'replace') cost = 10;
  else return res.status(400).json({ error: 'Неизвестная подсказка' });

  if (prog.totalScore < cost) return res.status(400).json({ error: `Недостаточно токенов. Нужно ${cost}` });

  if (hint === '5050') {
    const q = questions[prog.questionOrder[prog.currentIndex]];
    const wrongIndices = q.options.reduce((acc, opt, idx) => {
      if (opt !== q.correct) acc.push(idx);
      return acc;
    }, []);
    const removedIndices = shuffleArray(wrongIndices).slice(0, 2);
    prog.totalScore -= cost;
    prog.hintsUsed.push(hint);
    saveProgress();
    return res.json({ removedIndices, newScore: prog.totalScore });
  } else if (hint === 'replace') {
    const available = [];
    for (let i = prog.currentIndex + 1; i < prog.questionOrder.length; i++) available.push(i);
    if (available.length === 0) return res.status(400).json({ error: 'Нет вопросов для замены' });
    const swapIdx = available[Math.floor(Math.random() * available.length)];
    const temp = prog.questionOrder[prog.currentIndex];
    prog.questionOrder[prog.currentIndex] = prog.questionOrder[swapIdx];
    prog.questionOrder[swapIdx] = temp;
    const newQuestion = questions[prog.questionOrder[prog.currentIndex]];
    prog.totalScore -= cost;
    prog.hintsUsed.push(hint);
    saveProgress();
    return res.json({
      newQuestion: { text: newQuestion.text, options: newQuestion.options },
      newScore: prog.totalScore
    });
  }
});

bot.start((ctx) => {
  const keyboard = { inline_keyboard: [] };
  if (WEBAPP_URL) keyboard.inline_keyboard.push([{ text: '🕹️ Играть в Mini App', web_app: { url: WEBAPP_URL } }]);
  ctx.reply('🧠 Добро пожаловать в NEURON! Игра, где твой ум приносит токены.', { reply_markup: keyboard });
});

const WEBHOOK_PATH = '/webhook';
app.post(WEBHOOK_PATH, (req, res) => {
  res.sendStatus(200);
  bot.handleUpdate(req.body).catch(err => console.error('Ошибка:', err));
});

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
  }
});

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

process.on('uncaughtException', (err) => { console.error('UNCAUGHT EXCEPTION:', err.message); console.error(err.stack); });
process.on('unhandledRejection', (reason, promise) => { console.error('UNHANDLED REJECTION at:', promise); console.error('Reason:', reason); });

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (!BOT_TOKEN) { console.error('BOT_TOKEN is not set'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

app.get('/tonconnect-manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ url: "https://neuronl.bothost.tech", name: "NEURON Game", iconUrl: "https://neuronl.bothost.tech/icon.png" });
});
app.use((req, res, next) => { console.log(`${req.method} ${req.path}`); next(); });
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const QUESTIONS_PER_GAME = 10;
const MAX_FREE_GAMES_PER_DAY = 5;
const TOKENS_PER_QUESTION_FREE = 1;
const TOKENS_SUPER_FIRST = 10;
const TOKENS_SUPER_NEXT = 3;
const REFERRAL_BONUS = 50;
const REFERRAL_BONUS_NEW_USER = 10;

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function checkDailyLimit(prog) {
  const today = todayStr();
  if (prog.lastPlayDate !== today) { prog.lastPlayDate = today; prog.gamesPlayedToday = 0; }
  return prog.gamesPlayedToday || 0;
}

let questions = [];
function pickGameQuestions() {
  return shuffleArray([...Array(questions.length).keys()]).slice(0, Math.min(QUESTIONS_PER_GAME, questions.length));
}

async function loadQuestionsFromDB() {
  const { rows } = await db.query('SELECT * FROM questions ORDER BY id');
  questions = rows.map(r => ({ id: r.id, text: r.text, options: r.options, correct: r.correct, lang: r.lang }));
  console.log(`Загружено ${questions.length} вопросов из БД`);
}

const LANG_API_MAP = { en: 'en', fr: 'fr', es: 'es', zh: 'zh-CN', hi: 'hi', tr: 'tr', id: 'id' };

async function translateText(text, targetLang) {
  if (!text || !targetLang || targetLang === 'ru') return text;
  try {
    const { rows } = await db.query('SELECT translated FROM translations WHERE original = $1 AND lang = $2', [text, targetLang]);
    if (rows.length > 0) return rows[0].translated;
  } catch(e) {}
  const apiLang = LANG_API_MAP[targetLang] || targetLang;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|${apiLang}`, { signal: ctrl.signal });
    clearTimeout(tid);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      const tr = data.responseData.translatedText;
      db.query('INSERT INTO translations (original, lang, translated) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [text, targetLang, tr]).catch(() => {});
      return tr;
    }
  } catch(e) { console.error('translateText:', e.message); }
  return text;
}

async function translateQuestion(q, lang) {
  if (!lang || lang === 'ru') return q;
  try {
    const [text, correct, ...options] = await Promise.all([
      translateText(q.text, lang),
      translateText(q.correct, lang),
      ...q.options.map(o => translateText(o, lang))
    ]);
    return { ...q, text, options, correct };
  } catch(e) { return q; }
}

async function getPlayer(userId) {
  const { rows } = await db.query('SELECT * FROM players WHERE user_id = $1', [userId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    currentIndex: r.current_index, score: r.score, totalScore: r.total_score,
    gamesPlayed: r.games_played, gamesPlayedToday: r.games_played_today, lastPlayDate: r.last_play_date,
    hintsUsed: r.hints_used || [], questionOrder: r.question_order || [], name: r.name,
    questionStartTime: Number(r.question_start_time), superGamesTotal: r.super_games_total,
    superGamePending: r.super_game_pending, currentIsSuperGame: r.current_is_super_game,
    referralCount: r.referral_count || 0, referredBy: r.referred_by || null
  };
}

async function savePlayer(userId, prog) {
  await db.query(`
    INSERT INTO players (user_id, name, current_index, score, total_score, games_played, games_played_today,
      last_play_date, hints_used, question_order, question_start_time, super_games_total, super_game_pending,
      current_is_super_game, referral_count, referred_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (user_id) DO UPDATE SET
      name=EXCLUDED.name, current_index=EXCLUDED.current_index, score=EXCLUDED.score,
      total_score=EXCLUDED.total_score, games_played=EXCLUDED.games_played,
      games_played_today=EXCLUDED.games_played_today, last_play_date=EXCLUDED.last_play_date,
      hints_used=EXCLUDED.hints_used, question_order=EXCLUDED.question_order,
      question_start_time=EXCLUDED.question_start_time, super_games_total=EXCLUDED.super_games_total,
      super_game_pending=EXCLUDED.super_game_pending, current_is_super_game=EXCLUDED.current_is_super_game,
      referral_count=EXCLUDED.referral_count, referred_by=EXCLUDED.referred_by
  `, [userId, prog.name||'Игрок', prog.currentIndex||0, prog.score||0, prog.totalScore||0,
      prog.gamesPlayed||0, prog.gamesPlayedToday||0, prog.lastPlayDate||todayStr(),
      JSON.stringify(prog.hintsUsed||[]), JSON.stringify(prog.questionOrder||[]),
      prog.questionStartTime||0, prog.superGamesTotal||0, prog.superGamePending||false,
      prog.currentIsSuperGame||false, prog.referralCount||0, prog.referredBy||null]);
}

async function getOrCreatePlayer(userId, name) {
  let prog = await getPlayer(userId);
  if (!prog) {
    prog = { currentIndex:0, score:0, totalScore:0, gamesPlayed:0, gamesPlayedToday:0, lastPlayDate:todayStr(),
      hintsUsed:[], questionOrder:pickGameQuestions(), name:name||'Игрок', questionStartTime:0,
      superGamesTotal:0, superGamePending:false, currentIsSuperGame:false,
      referralCount:0, referredBy:null };
    await savePlayer(userId, prog);
  }
  return prog;
}

const DEFAULT_QUESTIONS = [
  { text:"Какой язык используется для смарт-контрактов в Ethereum?", options:["JavaScript","Solidity","Python","C++"], correct:"Solidity" },
  { text:"Что такое блокчейн?", options:["Распределённая база данных","Централизованный сервер","Язык программирования","Криптовалюта"], correct:"Распределённая база данных" },
  { text:"Кто создал Биткоин?", options:["Виталик Бутерин","Сатоши Накамото","Илон Маск","Чарльз Хоскинсон"], correct:"Сатоши Накамото" },
  { text:"Что такое NFT?", options:["Незаменяемый токен","Новая финансовая технология","Сетевая файловая система","Биржевой фонд"], correct:"Незаменяемый токен" },
  { text:"Что означает PoW (Proof of Work)?", options:["Подтверждение доли","Подтверждение работы","Подтверждение транзакции","Подтверждение владения"], correct:"Подтверждение работы" },
  { text:"Что такое DeFi?", options:["Децентрализованные финансы","Цифровые финансы","Безопасные финансы","Быстрые финансы"], correct:"Децентрализованные финансы" },
  { text:"Что такое газ в Ethereum?", options:["Комиссия за транзакцию","Вид криптовалюты","Тип кошелька","Протокол безопасности"], correct:"Комиссия за транзакцию" },
  { text:"Что такое приватный ключ?", options:["Секретный код для доступа к кошельку","Публичный адрес кошелька","Вид токена","Пароль от биржи"], correct:"Секретный код для доступа к кошельку" },
  { text:"Что такое стейкинг?", options:["Блокировка токенов для получения награды","Продажа токенов","Обмен токенов","Хранение токенов на бирже"], correct:"Блокировка токенов для получения награды" },
  { text:"Что такое seed-фраза?", options:["Набор слов для восстановления кошелька","Пароль от биржи","Адрес кошелька","Вид смарт-контракта"], correct:"Набор слов для восстановления кошелька" }
];

async function initDB() {
  await db.query(`CREATE TABLE IF NOT EXISTS players (
    user_id TEXT PRIMARY KEY, name TEXT DEFAULT 'Игрок', current_index INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0, total_score INTEGER DEFAULT 0, games_played INTEGER DEFAULT 0,
    games_played_today INTEGER DEFAULT 0, last_play_date TEXT DEFAULT '',
    hints_used JSONB DEFAULT '[]', question_order JSONB DEFAULT '[]',
    question_start_time BIGINT DEFAULT 0, super_games_total INTEGER DEFAULT 0,
    super_game_pending BOOLEAN DEFAULT false, current_is_super_game BOOLEAN DEFAULT false)`);
  await db.query(`CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY, lang VARCHAR(5) DEFAULT 'ru',
    text TEXT NOT NULL, options JSONB NOT NULL, correct TEXT NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS translations (
    original TEXT NOT NULL, lang VARCHAR(10) NOT NULL, translated TEXT NOT NULL,
    PRIMARY KEY (original, lang))`);
  await db.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0`);
  await db.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by TEXT DEFAULT NULL`);
  const { rows } = await db.query('SELECT COUNT(*) FROM questions');
  if (parseInt(rows[0].count) === 0) {
    for (const q of DEFAULT_QUESTIONS) {
      await db.query('INSERT INTO questions (lang,text,options,correct) VALUES ($1,$2,$3,$4)',
        ['ru', q.text, JSON.stringify(q.options), q.correct]);
    }
    console.log('Дефолтные вопросы загружены в БД');
  }
  await loadQuestionsFromDB();
  console.log('БД инициализирована');
}

const requestLog = new Map();
function rateLimiter(maxReq, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const log = (requestLog.get(ip)||[]).filter(t => t > now - windowMs);
    log.push(now); requestLog.set(ip, log);
    if (log.length > maxReq) return res.status(429).json({ error: 'Слишком много запросов. Притормози!' });
    next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [ip, times] of requestLog.entries()) {
    const fresh = times.filter(t => t > cutoff);
    if (fresh.length === 0) requestLog.delete(ip); else requestLog.set(ip, fresh);
  }
}, 300000);

function verifyTelegramInitData(initData, botToken) {
  if (!initData) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  const authDate = parseInt(params.get('auth_date') || '0');
  if (Math.floor(Date.now()/1000) - authDate > 86400) return false;
  params.delete('hash');
  const dataCheckString = Array.from(params.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  return crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex') === hash;
}
function requireInitData(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (initData && initData.length > 0) {
    if (verifyTelegramInitData(initData, BOT_TOKEN)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
function checkAdmin(req, res) {
  const auth = req.headers['x-admin-password'];
  if (!auth || auth !== ADMIN_PASSWORD) { res.status(401).json({ error: 'Неверный пароль' }); return false; }
  return true;
}

app.get('/api/question', rateLimiter(30, 60000), requireInitData, async (req, res) => {
  try {
    const userId = req.query.user_id || 'anonymous';
    const lang = req.query.lang || 'ru';
    const prog = await getOrCreatePlayer(userId, req.query.name);
    const gamesPlayedToday = checkDailyLimit(prog);
    const freeGamesLeft = Math.max(0, MAX_FREE_GAMES_PER_DAY - gamesPlayedToday);
    const qIndex = prog.questionOrder[prog.currentIndex];
    if (qIndex === undefined || !questions[qIndex]) {
      prog.currentIndex = 0; prog.questionOrder = pickGameQuestions(); prog.score = 0; prog.hintsUsed = [];
      await savePlayer(userId, prog);
    }
    const base = { total: QUESTIONS_PER_GAME, score: prog.score, totalScore: prog.totalScore||0,
      hintsUsed: prog.hintsUsed||[], gamesPlayed: prog.gamesPlayed||0, freeGamesLeft,
      superGamePending: prog.superGamePending, superGamesTotal: prog.superGamesTotal||0 };
    if (prog.currentIndex > 0 && prog.currentIndex < QUESTIONS_PER_GAME) {
      const tq = await translateQuestion(questions[prog.questionOrder[prog.currentIndex]], lang);
      prog.questionStartTime = Date.now(); await savePlayer(userId, prog);
      return res.json({ ...base, text: tq.text, options: tq.options, index: prog.currentIndex });
    }
    if (prog.currentIndex >= QUESTIONS_PER_GAME) return res.json({ ...base, finished: true });
    if (freeGamesLeft <= 0 && !prog.superGamePending) return res.json({ ...base, finished: true, noGamesLeft: true, score: 0 });
    const firstQ = questions[prog.questionOrder[0]];
    if (!firstQ) return res.json({ ...base, finished: true, score: 0 });
    const tq = await translateQuestion(firstQ, lang);
    prog.questionStartTime = Date.now(); await savePlayer(userId, prog);
    res.json({ ...base, text: tq.text, options: tq.options, index: 0, hintsUsed: [] });
  } catch (e) { console.error('/api/question error:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/answer', rateLimiter(30, 60000), requireInitData, async (req, res) => {
  try {
    const { user_id, answer, name, lang } = req.body;
    const userId = user_id || 'anonymous';
    const userLang = lang || 'ru';
    if (answer === 'reset') {
      const prev = await getPlayer(userId) || { totalScore:0, gamesPlayed:0, gamesPlayedToday:0,
        lastPlayDate:todayStr(), name:name||'Игрок', superGamesTotal:0, superGamePending:false, currentIsSuperGame:false };
      checkDailyLimit(prev);
      const isSuperGame = prev.superGamePending || false;
      const freeGamesLeft = Math.max(0, MAX_FREE_GAMES_PER_DAY - (prev.gamesPlayedToday||0));
      if (!isSuperGame && freeGamesLeft <= 0) return res.json({ noGamesLeft: true, freeGamesLeft: 0, totalScore: prev.totalScore||0 });
      await savePlayer(userId, { ...prev, currentIndex:0, score:0, hintsUsed:[], questionOrder:pickGameQuestions(),
        questionStartTime:0, superGamePending:false, currentIsSuperGame:isSuperGame });
      return res.json({ reset: true, freeGamesLeft, isSuperGame });
    }
    const prog = await getOrCreatePlayer(userId, name);
    checkDailyLimit(prog);
    if (prog.currentIndex >= QUESTIONS_PER_GAME) return res.json({ finished: true, score: prog.score, totalScore: prog.totalScore });
    if (Date.now() - (prog.questionStartTime||0) < 2000) return res.status(400).json({ error: 'Слишком быстро! Прочитай вопрос.' });
    const q = questions[prog.questionOrder[prog.currentIndex]];
    if (!q) {
      prog.currentIndex=0; prog.questionOrder=pickGameQuestions(); prog.score=0; prog.hintsUsed=[];
      await savePlayer(userId, prog);
      return res.json({ finished:true, score:0, totalScore:prog.totalScore, gamesPlayed:prog.gamesPlayed,
        freeGamesLeft: Math.max(0, MAX_FREE_GAMES_PER_DAY-(prog.gamesPlayedToday||0)) });
    }
    const answerIdx = parseInt(answer);
    const isCorrect = (!isNaN(answerIdx) && answerIdx >= 0 && answerIdx < q.options.length)
      ? q.options[answerIdx] === q.correct : answer === q.correct;
    const correctIndex = q.options.findIndex(opt => opt === q.correct);
    const tokensNow = prog.currentIsSuperGame
      ? (prog.superGamesTotal===1 ? TOKENS_SUPER_FIRST : TOKENS_SUPER_NEXT) : TOKENS_PER_QUESTION_FREE;
    if (isCorrect) prog.score += tokensNow;
    prog.currentIndex += 1;
    const isFinished = prog.currentIndex >= QUESTIONS_PER_GAME || prog.currentIndex >= prog.questionOrder.length;
    if (isFinished) {
      prog.totalScore = (prog.totalScore||0) + prog.score;
      prog.gamesPlayed = (prog.gamesPlayed||0) + 1;
      if (!prog.currentIsSuperGame) prog.gamesPlayedToday = (prog.gamesPlayedToday||0) + 1;
      prog.currentIsSuperGame = false;
    }
    if (!isFinished) prog.questionStartTime = Date.now();
    await savePlayer(userId, prog);
    const freeGamesLeft = Math.max(0, MAX_FREE_GAMES_PER_DAY - (prog.gamesPlayedToday||0));
    let message = isCorrect
      ? `✅ Правильно! +${tokensNow} токен${tokensNow>1?'ов':''}. Счёт: ${prog.score}`
      : `❌ Неправильно. Правильный ответ: ${q.correct}.`;
    if (isFinished) message += `\n\n🎉 Игра завершена! Ты набрал ${prog.score} токенов.`;
    const response = { correct:isCorrect, correctIndex, finished:isFinished, score:prog.score,
      totalScore:prog.totalScore, gamesPlayed:prog.gamesPlayed, freeGamesLeft, message,
      total:QUESTIONS_PER_GAME, superGamePending:prog.superGamePending, superGamesTotal:prog.superGamesTotal||0 };
    if (!isFinished) {
      const nextQ = questions[prog.questionOrder[prog.currentIndex]];
      if (nextQ) {
        const tNextQ = await translateQuestion(nextQ, userLang);
        response.nextQuestion = { text: tNextQ.text, options: tNextQ.options };
        response.nextIndex = prog.currentIndex;
      } else { response.finished = true; }
    }
    res.json(response);
  } catch (e) { console.error('/api/answer error:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/leaderboard', rateLimiter(30, 60000), requireInitData, async (req, res) => {
  try {
    const userId = req.query.user_id;
    const { rows } = await db.query('SELECT user_id AS id, name, total_score, games_played FROM players ORDER BY total_score DESC');
    const top10 = rows.slice(0,10).map(r => ({ id:r.id, name:r.name, totalScore:r.total_score, gamesPlayed:r.games_played }));
    const myRank = rows.findIndex(r => String(r.id)===String(userId)) + 1;
    const meRow = rows.find(r => String(r.id)===String(userId));
    const me = meRow ? { id:meRow.id, name:meRow.name, totalScore:meRow.total_score, gamesPlayed:meRow.games_played } : null;
    res.json({ top10, myRank, me });
  } catch (e) { console.error('/api/leaderboard error:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/referral-stats', rateLimiter(20, 60000), requireInitData, async (req, res) => {
  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    const prog = await getPlayer(userId);
    const referralLink = botUsername ? `https://t.me/${botUsername}?start=ref_${userId}` : null;
    res.json({ referralCount: prog?.referralCount || 0, referralLink, bonusPerReferral: REFERRAL_BONUS });
  } catch(e) { console.error('/api/referral-stats error:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/api/admin/stats', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { rows } = await db.query('SELECT user_id AS id, name, total_score, games_played, games_played_today, score FROM players ORDER BY total_score DESC');
    res.json({ players: rows.map(r => ({ id:r.id, name:r.name, totalScore:r.total_score, gamesPlayed:r.games_played, gamesPlayedToday:r.games_played_today, currentScore:r.score })), totalPlayers: rows.length });
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});
app.get('/api/admin/questions', async (req, res) => { if (!checkAdmin(req, res)) return; res.json(questions); });
app.post('/api/admin/questions/add', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { text, options, correct, lang } = req.body;
    if (!text||!options||!correct) return res.status(400).json({ error: 'Неверные данные' });
    await db.query('INSERT INTO questions (lang,text,options,correct) VALUES ($1,$2,$3,$4)', [lang||'ru', text, JSON.stringify(options), correct]);
    await loadQuestionsFromDB();
    res.json({ ok: true, total: questions.length });
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});
app.post('/api/admin/questions/delete', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { index } = req.body;
    if (index < 0 || index >= questions.length) return res.status(400).json({ error: 'Неверный индекс' });
    await db.query('DELETE FROM questions WHERE id = $1', [questions[index].id]);
    await loadQuestionsFromDB();
    res.json({ ok: true, total: questions.length });
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});
app.post('/api/admin/reset-player', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { userId } = req.body;
    const prog = await getPlayer(userId);
    if (prog) await savePlayer(userId, { ...prog, currentIndex:0, score:0, totalScore:0, gamesPlayed:0, gamesPlayedToday:0,
      lastPlayDate:todayStr(), hintsUsed:[], questionOrder:pickGameQuestions(), questionStartTime:0,
      superGamesTotal:0, superGamePending:false, currentIsSuperGame:false });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});
app.post('/api/admin/delete-player', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { userId } = req.body;
    const { rowCount } = await db.query('DELETE FROM players WHERE user_id = $1', [userId]);
    if (rowCount > 0) res.json({ ok: true }); else res.status(404).json({ error: 'Игрок не найден' });
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/use-hint', rateLimiter(20, 60000), requireInitData, async (req, res) => {
  try {
    const { user_id, hint } = req.body;
    const userId = user_id || 'anonymous';
    const prog = await getPlayer(userId);
    if (!prog) return res.status(400).json({ error: 'Игрок не найден' });
    if (prog.currentIndex >= QUESTIONS_PER_GAME) return res.status(400).json({ error: 'Викторина завершена' });
    if (!prog.hintsUsed) prog.hintsUsed = [];
    if (prog.hintsUsed.includes(hint)) return res.status(400).json({ error: 'Подсказка уже использована' });
    let cost = hint==='5050' ? 5 : hint==='replace' ? 10 : null;
    if (cost === null) return res.status(400).json({ error: 'Неизвестная подсказка' });
    if (prog.totalScore < cost) return res.status(400).json({ error: `Недостаточно токенов. Нужно ${cost}` });
    if (hint === '5050') {
      const q = questions[prog.questionOrder[prog.currentIndex]];
      const wrongIndices = q.options.reduce((acc,opt,idx) => { if (opt!==q.correct) acc.push(idx); return acc; }, []);
      const removedIndices = shuffleArray(wrongIndices).slice(0, 2);
      prog.totalScore -= cost; prog.hintsUsed.push(hint);
      await savePlayer(userId, prog);
      return res.json({ removedIndices, newScore: prog.totalScore });
    } else {
      const available = [];
      for (let i = prog.currentIndex+1; i < prog.questionOrder.length; i++) available.push(i);
      if (available.length === 0) return res.status(400).json({ error: 'Нет вопросов для замены' });
      const swapIdx = available[Math.floor(Math.random()*available.length)];
      [prog.questionOrder[prog.currentIndex], prog.questionOrder[swapIdx]] = [prog.questionOrder[swapIdx], prog.questionOrder[prog.currentIndex]];
      const newQ = questions[prog.questionOrder[prog.currentIndex]];
      prog.totalScore -= cost; prog.hintsUsed.push(hint);
      await savePlayer(userId, prog);
      return res.json({ newQuestion: { text: newQ.text, options: newQ.options }, newScore: prog.totalScore });
    }
  } catch (e) { console.error('/api/use-hint error:', e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/create-stars-invoice', rateLimiter(10, 60000), requireInitData, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const link = await bot.telegram.createInvoiceLink(
      '🔥 Супер игра NEURON',
      'Первая игра: x10 токенов за вопрос. Максимум 100 токенов!',
      `super_game_${user_id}`, '', 'XTR', [{ label: 'Супер игра', amount: 100 }]);
    res.json({ link });
  } catch (e) { console.error('Stars invoice error:', e.message); res.status(500).json({ error: 'Ошибка создания инвойса' }); }
});

bot.on('pre_checkout_query', ctx => ctx.answerPreCheckoutQuery(true));
bot.on('successful_payment', async ctx => {
  const payment = ctx.message?.successful_payment;
  if (!payment?.invoice_payload?.startsWith('super_game_')) return;
  const userId = payment.invoice_payload.replace('super_game_', '');
  const tgName = ctx.from.first_name || ctx.from.username || 'Игрок';
  const prog = await getOrCreatePlayer(userId, tgName);
  prog.superGamesTotal = (prog.superGamesTotal||0) + 1;
  prog.superGamePending = true;
  await savePlayer(userId, prog);
  ctx.reply('✅ Оплата получена! Супер игра активирована.\nОткрой игру и нажми "Начать игру" 🔥');
});

let botUsername = '';

bot.start(async ctx => {
  const tgId = String(ctx.from.id);
  const tgName = ctx.from.first_name || ctx.from.username || 'Игрок';
  const payload = ctx.startPayload;

  const existing = await getPlayer(tgId);
  const prog = await getOrCreatePlayer(tgId, tgName);
  prog.name = tgName;

  if (!existing && payload?.startsWith('ref_')) {
    const referrerId = payload.replace('ref_', '');
    if (referrerId !== tgId) {
      prog.referredBy = referrerId;
      prog.totalScore = (prog.totalScore || 0) + REFERRAL_BONUS_NEW_USER;
      await savePlayer(tgId, prog);
      const referrer = await getPlayer(referrerId);
      if (referrer) {
        referrer.totalScore = (referrer.totalScore || 0) + REFERRAL_BONUS;
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        await savePlayer(referrerId, referrer);
        try {
          await ctx.telegram.sendMessage(referrerId,
            `🎉 Твой друг ${tgName} присоединился по твоей ссылке!\n+${REFERRAL_BONUS} токенов начислено! 🏆`);
        } catch(e) {}
      }
    } else { await savePlayer(tgId, prog); }
  } else { await savePlayer(tgId, prog); }

  const webAppUrl = WEBAPP_URL + '?uid=' + tgId + '&uname=' + encodeURIComponent(tgName);
  const keyboard = { inline_keyboard: [] };
  if (WEBAPP_URL) keyboard.inline_keyboard.push([{ text: '🕹️ Играть в Mini App', web_app: { url: webAppUrl } }]);
  ctx.reply('🧠 Добро пожаловать в NEURON! Игра, где твой ум приносит токены.', { reply_markup: keyboard });
});

const WEBHOOK_PATH = '/webhook';
app.post(WEBHOOK_PATH, (req, res) => { res.sendStatus(200); bot.handleUpdate(req.body).catch(err => console.error('Ошибка:', err)); });

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    try {
      const botInfo = await bot.telegram.getMe();
      botUsername = botInfo.username;
      console.log(`Бот: @${botUsername}`);
    } catch(e) { console.error('Не удалось получить username бота:', e.message); }
    if (WEBHOOK_URL) {
      try { await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`); console.log(`Вебхук установлен: ${WEBHOOK_URL}${WEBHOOK_PATH}`); }
      catch (err) { console.error('Ошибка установки вебхука:', err.message); }
    }
  });
}).catch(err => { console.error('Ошибка инициализации БД:', err.message); process.exit(1); });

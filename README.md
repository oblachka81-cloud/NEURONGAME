function showWelcome(totalScore, gamesPlayed) {
  const phrases = [
    "Твой мозг просит тренировки 💪","Сегодня умнее, чем вчера 🧬",
    "Каждый вопрос — новый нейрон 🔥","Готов побить свой рекорд? ⚡",
    "Знания = токены. Погнали! 🚀","Прокачай интеллект прямо сейчас 🎯"
  ];
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  const wallet = tonConnectUI ? tonConnectUI.wallet : null;
  const MIN_WITHDRAW = 500;
  let withdrawHtml = '';
  if (wallet) {
    if (totalScore >= MIN_WITHDRAW) {
      withdrawHtml = `<button class="withdraw-btn" id="withdrawBtn">💸 Вывести ${totalScore} NEURON</button>`;
    } else {
      withdrawHtml = `<button class="withdraw-btn disabled" id="withdrawBtn" disabled>💸 Нужно ещё ${MIN_WITHDRAW - totalScore} токенов</button>`;
    }
  }
  const freeGamesLeft = currentState.freeGamesLeft;
  const isFirstSuperGame = currentState.superGamesTotal === 0;
  const superGameCard = `
    <div class="super-game-card">
      <div class="super-game-title">🔥 Супер игра</div>
      <div class="super-game-desc">${isFirstSuperGame ? 'Первая игра — x10 токенов за вопрос!' : 'x3 токена за вопрос'}</div>
      <div class="super-game-btns">
        <button class="stars-btn" id="buyStarsBtn">⭐ 100 Stars</button>
        <button class="usdt-btn" disabled style="opacity:0.5;cursor:not-allowed">💎 1 USDT скоро</button>
      </div>
    </div>`;

  let startBtnHtml = '';
  if (currentState.superGamePending) {
    startBtnHtml = `<button id="startNewBtn">🔥 Начать супер игру!</button>`;
  } else if (freeGamesLeft > 0) {
    startBtnHtml = `<button id="startNewBtn">🚀 Начать игру (осталось ${freeGamesLeft})</button>`;
  } else {
    startBtnHtml = `<button id="startNewBtn" disabled style="opacity:0.5;pointer-events:none;">⛔ Лимит игр на сегодня (5/5)</button>`;
  }

  root.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-title">🧠 NEURON</div>
      <div class="welcome-phrase">${phrase}</div>
      <div class="welcome-badges">
        <div class="welcome-badge" id="tokenBadge">🏆 0 токенов</div>
        <div class="welcome-badge">🎮 ${gamesPlayed} игр</div>
      </div>
      ${superGameCard}
      <button class="wallet-btn" id="walletBtn">💎 Подключить кошелёк</button>
      ${withdrawHtml}
      ${startBtnHtml}
    </div>
  `;

  const tokenEl = document.getElementById('tokenBadge');
  let current = 0;
  const step = Math.max(1, Math.ceil(totalScore / 40));
  const counter = setInterval(() => {
    current = Math.min(current + step, totalScore);
    tokenEl.innerText = `🏆 ${current} токенов`;
    if (current >= totalScore) clearInterval(counter);
  }, 30);

  updateWalletBtn(wallet);

  const withdrawBtn = document.getElementById('withdrawBtn');
  if (withdrawBtn && !withdrawBtn.disabled) {
    withdrawBtn.addEventListener('click', () => showToast('🚀 Вывод откроется после запуска токена NEURON!', 4000));
  }

  const starsBtn = document.getElementById('buyStarsBtn');
  if (starsBtn) {
    starsBtn.addEventListener('click', async () => {
      starsBtn.disabled = true;
      starsBtn.textContent = '⏳ ...';
      try {
        const res = await fetch(`${BASE_URL}/api/create-stars-invoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getInitData() },
          body: JSON.stringify({ user_id: userId })
        });
        const data = await res.json();
        if (data.error) {
          showToast(`⚠️ ${data.error}`, 3000);
          starsBtn.disabled = false;
          starsBtn.textContent = '⭐ 100 Stars';
          return;
        }
        tg.openInvoice(data.link, (status) => {
          if (status === 'paid') {
            showToast('✅ Оплата прошла! Нажми "Начать игру"', 4000);
            currentState.superGamePending = true;
            currentState.superGamesTotal += 1;
            setTimeout(() => loadWelcome(), 500);
          } else if (status === 'cancelled') {
            showToast('Оплата отменена', 2000);
          } else if (status === 'failed') {
            showToast('⚠️ Ошибка оплаты', 3000);
          }
          starsBtn.disabled = false;
          starsBtn.textContent = '⭐ 100 Stars';
        });
      } catch(e) {
        showToast('⚠️ Ошибка подключения', 3000);
        starsBtn.disabled = false;
        starsBtn.textContent = '⭐ 100 Stars';
      }
    });
  }

  const startBtn = document.getElementById('startNewBtn');
  if (startBtn && !startBtn.disabled) {
    startBtn.addEventListener('click', () => {
      clearInterval(counter);
      fetch(`${BASE_URL}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getInitData() },
        body: JSON.stringify({ user_id: userId, answer: 'reset', name: userName })
      }).then(r => r.json()).then(data => {
        if (data.noGamesLeft) showToast('⛔ Лимит игр на сегодня исчерпан!', 3000);
        loadFirstQuestion();
      }).catch(() => loadFirstQuestion());
    });
  }
}

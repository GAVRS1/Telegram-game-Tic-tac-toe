import { me, Game, refreshIdentity, WIN_PHRASES, LOSE_PHRASES, DRAW_PHRASES, pick, el } from './state.js';
import { openWs, sendWs } from './ws.js';
import { mountNav } from './ui/nav.js';
import { showModal, hideModal } from './ui/modal.js';
import { mountBoard, UI, highlightWin, clearHighlights, toLobby } from './game/board.js';
import { AnimationController } from './animations.js';
import { notificationSystem } from './notifications.js';
import { audioManager } from './audio.js';
import { achievementSystem } from './achievements.js';
import { statsSystem } from './stats.js';

const animationController = new AnimationController();

window.notificationSystem = notificationSystem;
window.audioManager = audioManager;
window.achievementSystem = achievementSystem;
window.statsSystem = statsSystem;

const appRoot = document.getElementById('app') || document.body;
mountBoard(appRoot);

const nav = mountNav();

const pendingOpponentProfiles = new Set();

function normalizeId(id) {
  if (id == null) return '';
  return String(id).trim();
}

function isNumericId(id) {
  return /^[0-9]+$/.test(id);
}

function needsOpponentDetails(opp) {
  if (!opp) return false;
  const hasAvatar = typeof opp.avatar === 'string' && opp.avatar.trim() !== '';
  const hasUsername = typeof opp.username === 'string' && opp.username.trim() !== '';
  return !hasAvatar || !hasUsername;
}

async function ensureOpponentProfile() {
  const opp = Game.opp;
  if (!opp || !opp.id) return;

  const id = normalizeId(opp.id);
  if (!isNumericId(id)) return;
  if (!needsOpponentDetails(opp)) return;
  if (pendingOpponentProfiles.has(id)) return;

  pendingOpponentProfiles.add(id);
  try {
    const response = await fetch(`/profile/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const profile = data?.profile || null;
    if (!profile) return;
    if (!Game.opp || normalizeId(Game.opp.id) !== id) return;

    const avatar = typeof profile.avatar_url === 'string' ? profile.avatar_url.trim() : '';
    const usernameRaw = typeof profile.username === 'string' ? profile.username.trim() : '';
    const username = usernameRaw.replace(/^@/, '');

    const updatedOpp = {
      ...Game.opp,
      avatar: avatar || Game.opp.avatar || '',
      username: username || Game.opp.username || '',
    };

    Game.opp = updatedOpp;
    Game.lastOpp = { ...updatedOpp };
    UI.applyNames();
  } catch (error) {
    console.warn('Не удалось загрузить профиль соперника', error);
  } finally {
    pendingOpponentProfiles.delete(id);
  }
}

// центральная кнопка: поиск/сдаться/реванш
nav.onAction((mode) => {
  if (mode === 'find') {
    sendWs({ t: 'queue.join' });
    notificationSystem.info('Поиск соперника...');
    audioManager.playClick();
  }
  if (mode === 'resign') {
    if (Game.gameId) {
      showModal(
        'Сдаться?',
        'Вы уверены, что хотите сдаться?',
        { label: 'Сдаться', onClick: () => { sendWs({ t: 'game.resign', gameId: Game.gameId }); hideModal(); audioManager.playClick(); } },
        { label: 'Отмена', onClick: () => { hideModal(); audioManager.playClick(); } }
      );
    }
  }
  if (mode === 'rematch') inviteLastOpponent(); // пункт 1: нажали «Реванш» → сразу отправляем приглашение
});

function buildResultContent(baseText, phrasesPool) {
  const blocks = [el('p', { class: 'modal-text' }, String(baseText ?? ''))];
  const extra = Array.isArray(phrasesPool) && phrasesPool.length ? pick(phrasesPool) : null;
  if (extra) blocks.push(el('p', { class: 'modal-phrase' }, extra));
  return blocks;
}

function inviteLastOpponent() {
  if (!Game.lastOpp?.id) { sendWs({ t: 'queue.join' }); return; }
  UI.setStatus('Отправлено приглашение на реванш…', true);
  notificationSystem.info('Приглашение отправлено');
  sendWs({ t: 'rematch.offer', to: Game.lastOpp.id, prevGameId: Game.gameId || null });
  audioManager.playClick();
}

function acceptRematch(fromId) { UI.setStatus('Подтверждение реванша…'); sendWs({ t: 'rematch.accept', to: fromId }); audioManager.playClick(); }
function declineRematch(fromId) { sendWs({ t: 'rematch.decline', to: fromId }); toLobby(); audioManager.playClick(); }

openWs(
  () => {
    const initData = window?.Telegram?.WebApp?.initData || '';
    sendWs({ t: 'hello', uid: me.id, name: me.name, username: me.username, avatar: me.avatar, initData });
    UI.setStatus('Онлайн: подключено');
    nav.setMode('find');
    UI.applyNames();
    notificationSystem.success('Подключено к серверу');
    audioManager.playNotification();

    setTimeout(() => {
      if (refreshIdentity()) {
        const initData2 = window?.Telegram?.WebApp?.initData || '';
        sendWs({ t: 'hello', uid: me.id, name: me.name, username: me.username, avatar: me.avatar, initData: initData2 });
        UI.applyNames();
      }
    }, 120);
  },
  (msg) => {
    if (msg.t === 'game.start') {
      Game.gameId = msg.gameId;
      Game.you = msg.you;
      Game.turn = msg.turn || 'X';

      const rawOpp = (msg.opp && typeof msg.opp === 'object') ? msg.opp : null;
      const incomingOpp = rawOpp ? {
        id: rawOpp.id,
        name: typeof rawOpp.name === 'string' ? rawOpp.name.trim() : '',
        username: typeof rawOpp.username === 'string' ? rawOpp.username.trim() : '',
        avatar: typeof rawOpp.avatar === 'string' ? rawOpp.avatar.trim() : '',
      } : null;

      Game.opp = (incomingOpp && String(incomingOpp.id) === String(me.id)) ? null : incomingOpp;
      // фикс: всегда обновляем lastOpp при старте игры
      Game.lastOpp = Game.opp ? { ...Game.opp } : Game.lastOpp;
      
      UI.applyNames();
      Game.resetBoard();
      clearHighlights();

      hideModal();
      UI.setStatus(Game.myMoveAllowed() ? 'Ваш ход' : 'Ход оппонента');
      UI.renderBoard();
      ensureOpponentProfile();
      nav.setMode('resign');

      notificationSystem.success('Игра началась!');
      audioManager.playNotification();
      statsSystem.startGame();
      return;
    }

    if (msg.t === 'game.state') {
      if (Array.isArray(msg.board)) Game.board = msg.board.slice();
      if (msg.turn) Game.turn = msg.turn;
      UI.renderBoard();

      if (msg.win) {
        highlightWin(msg.win.line);
        nav.setMode('rematch'); // центр-кнопка теперь «Реванш» и отправит приглашение по нажатию

        const youWon = (msg.win.by !== null && msg.win.by === Game.you);
        const youLost = (msg.win.by !== null && msg.win.by !== Game.you);
        const oppLabel = Game.opp?.name || 'оппонент';

        let title = 'Ничья 🤝';
        let text = `Сыграли вничью с ${oppLabel}.`;
        let phrasePool = DRAW_PHRASES;

        if (youWon) {
          title = 'Победа 🎉';
          text = `Вы обыграли ${oppLabel}.`;
          phrasePool = WIN_PHRASES;
          audioManager.playWin();
          statsSystem.endGame('win');
        } else if (youLost) {
          title = 'Поражение 😔';
          text = `${oppLabel} выиграл(а).`;
          phrasePool = LOSE_PHRASES;
          audioManager.playLose();
          statsSystem.endGame('lose');
        } else {
          audioManager.playDraw();
          statsSystem.endGame('draw');
        }

        const modalContent = buildResultContent(text, phrasePool);

        showModal(
          title, modalContent,
          { label: 'Реванш', onClick: () => { hideModal(); inviteLastOpponent(); } }, // пункт 1: кнопка модалки тоже сразу шлёт приглашение
          { label: 'Выйти', onClick: () => { toLobby(); nav.setMode('find'); } }
        );

        UI.setStatus(youWon ? 'Победа!' : youLost ? 'Поражение' : 'Ничья');
      } else {
        UI.setStatus(Game.myMoveAllowed() ? 'Ваш ход' : 'Ход оппонента');
        if (Game.myMoveAllowed()) audioManager.playMove();
      }
      return;
    }

    if (msg.t === 'game.end') {
      // гарантируем, что lastOpp не потеряется даже при дисконнекте/сдаче
      if (!Game.lastOpp && Game.opp) Game.lastOpp = { ...Game.opp };

      const winnerMark = typeof msg.by === 'string' ? msg.by : null;
      const youWon = winnerMark && winnerMark === Game.you;
      const youLost = winnerMark && winnerMark !== Game.you;

      if (msg.reason === 'win' || msg.reason === 'draw') {
        nav.setMode('rematch');
        return;
      }

      nav.setMode('rematch');

      let title = 'Игра завершена';
      let mainText = 'Игра завершена.';
      let phrases = null;
      let statusText = 'Игра завершена';

      if (msg.reason === 'resign') {
        if (youWon) {
          title = 'Победа 🎉';
          mainText = 'Оппонент сдался.';
          phrases = WIN_PHRASES;
          statusText = 'Победа!';
          audioManager.playWin();
          statsSystem.endGame('win');
        } else if (youLost) {
          title = 'Поражение 😔';
          mainText = 'Вы сдались.';
          phrases = LOSE_PHRASES;
          statusText = 'Поражение';
          audioManager.playLose();
          statsSystem.endGame('lose');
        } else {
          mainText = 'Игра завершилась сдачей.';
          audioManager.playNotification();
        }
      } else if (msg.reason === 'disconnect') {
        if (youWon) {
          title = 'Победа 🎉';
          mainText = 'Оппонент отключился.';
          phrases = WIN_PHRASES;
          statusText = 'Победа!';
          audioManager.playWin();
          statsSystem.endGame('win');
        } else if (youLost) {
          title = 'Поражение 😔';
          mainText = 'Вы были отключены.';
          phrases = LOSE_PHRASES;
          statusText = 'Поражение';
          audioManager.playLose();
          statsSystem.endGame('lose');
        } else {
          mainText = 'Игра завершилась из-за отключения.';
          audioManager.playNotification();
        }
      } else {
        if (youWon) {
          title = 'Победа 🎉';
          mainText = 'Вы победили!';
          phrases = WIN_PHRASES;
          statusText = 'Победа!';
          statsSystem.endGame('win');
        } else if (youLost) {
          title = 'Поражение 😔';
          mainText = 'Вы проиграли.';
          phrases = LOSE_PHRASES;
          statusText = 'Поражение';
          statsSystem.endGame('lose');
        }
      }

      const modalContent = buildResultContent(mainText, phrases);

      showModal(
        title,
        modalContent,
        { label: 'Реванш', onClick: () => { hideModal(); inviteLastOpponent(); } },
        { label: 'Выйти', onClick: () => { toLobby(); nav.setMode('find'); } }
      );

      UI.setStatus(statusText);
      return;
    }

    if (msg.t === 'rematch.offer' && msg.from) {
      if (String(msg.from.id) === String(me.id)) return;
      Game.lastOpp = {
        id: msg.from.id,
        name: msg.from.name,
        username: msg.from.username || '',
        avatar: msg.from.avatar,
      };
      showModal(
        'Реванш',
        `${msg.from.name || 'Оппонент'} предлагает реванш!`,
        { label: 'Принять', onClick: () => { hideModal(); acceptRematch(msg.from.id); } },
        { label: 'Отказаться', onClick: () => { hideModal(); declineRematch(msg.from.id); nav.setMode('find'); } }
      );
      audioManager.playNotification();
      return;
    }

    if (msg.t === 'rematch.declined') {
      showModal(
        'Реванш отклонён',
        'Соперник отказался от реванша. Вы возвращены в лобби.',
        { label: 'Ок', onClick: () => { toLobby(); nav.setMode('find'); } },
        { label: '', show: false }
      );
      return;
    }
  },
  () => {
    UI.setStatus('Отключено. Переподключение…', true);
    notificationSystem.error('Соединение потеряно');
  }
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideModal();
  if (e.key === ' ' && !Game.gameId) { e.preventDefault(); sendWs({ t: 'queue.join' }); }
});

document.addEventListener('visibilitychange', () => {
  document.body.style.animationPlayState = document.hidden ? 'paused' : 'running';
});

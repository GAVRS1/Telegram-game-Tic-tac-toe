import { $, el } from '../state.js';
import { showModal, hideModal, setModalContent } from './modal.js';

export function mountNav() {
  const nav = el('div', { class:'navbar navbar--lg' },
    el('button', { class:'navbtn', id:'tabRating' },
      el('div', { class:'sym' }, el('img', { src:'img/leaderboard.png', alt:'Рейтинг', class:'icon' })),
      el('div', { class:'label' }, 'Рейтинг')
    ),
    el('button', { class:'navbtn centerAction active', id:'tabGame' },
      el('div', { class:'sym',  id:'centerSym' }, el('img', { src:'img/search.png', alt:'Действие', class:'icon-lg' })),
      el('div', { class:'label', id:'centerActionLabel' }, 'Найти соперника')
    ),
    el('button', { class:'navbtn', id:'tabProfile' },
      el('div', { class:'sym' }, el('img', { src:'img/profile-info.png', alt:'Профиль', class:'icon' })),
      el('div', { class:'label' }, 'Профиль')
    )
  );
  (document.getElementById('navbar') || document.body).appendChild(nav);

  const tabGame = $('#tabGame', nav);
  const centerSymImg = $('#centerSym img', nav);
  const centerLabel = $('#centerActionLabel', nav);

  let currentMode = 'find'; // 'find' | 'resign' | 'rematch'
  let onAction = null;

  const ICONS = {
    find:   'img/search.png',
    resign: 'img/surrender.png',
    rematch:'img/search.png',
  };
  const LABELS = {
    find:   'Найти соперника',
    resign: 'Сдаться',
    rematch:'Реванш',
  };

  function setMode(mode) {
    currentMode = mode;
    centerSymImg.src = ICONS[mode] || ICONS.find;
    centerLabel.textContent = LABELS[mode] || '';
  }

  tabGame.addEventListener('click', () => onAction?.(currentMode));

  // === РЕЙТИНГ (п.2) ===
  $('#tabRating', nav).addEventListener('click', async () => {
    showModal('Топ игроков', 'Загрузка…', { label:'Закрыть', onClick:()=>hideModal() }, { show:false });

    try {
      const r = await fetch('leaders', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const rows = Array.isArray(data?.leaders) ? data.leaders : [];
      const list = el('div', { style:'display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto' });
      if (rows.length === 0) {
        list.appendChild(el('div', {}, 'Список пуст.'));
      } else {
        rows.forEach((u, i) => {
          list.appendChild(
            el('div', { style:'display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:8px' },
              el('div', { style:'width:24px;text-align:right;font-weight:700' }, String(i+1)),
              el('img', { src: u.avatar_url || 'img/logo.svg', alt:'', style:'width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid var(--line)' }),
              el('div', { style:'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, sanitize(u.username || 'Player')),
              el('div', { style:'display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:12px;color:var(--muted)' },
                el('div', { style:'font-weight:700;color:var(--text)' }, `🏆 ${Number(u.wins ?? 0)}`),
                el('div', {}, `🎮 ${Number(u.games_played ?? 0)} | ⚖️ ${Number(u.win_rate ?? 0)}%`)
              )
            )
          );
        });
      }
      setModalContent(list);
    } catch (e) {
      const msg = 'Рейтинг недоступен. Проверь БД и /leaders.';
      setModalContent(msg);
    }
  });

  // === ПРОФИЛЬ (п.3): достижения + локальная статистика ===
  $('#tabProfile', nav).addEventListener('click', async () => {
    showModal('Профиль', 'Загрузка…', { label:'Ок', onClick:()=>hideModal() }, { show:false });

    const [serverResult, achs] = await Promise.all([
      fetchProfileFromServer(),
      Promise.resolve(safeAchievements()),
    ]);

    const stats = mergeStatsSummary(serverResult?.profile || null);

    const wrap = el('div', { style:'display:flex;flex-direction:column;gap:12px' },
      el('div', { style:'display:flex;gap:10px;align-items:center' },
        el('img', { src: (serverResult?.profile?.avatar_url || achs.avatar || 'img/logo.svg'), alt:'', style:'width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid var(--line)' }),
        el('div', { style:'font-weight:800' }, sanitize(achs.name || 'Профиль'))
      ),
      // итоги
      el('div', { style:'display:grid;grid-template-columns:repeat(3,1fr);gap:8px' },
        statCard('Игры', stats.gamesPlayed),
        statCard('Победы', stats.wins),
        statCard('Поражения', stats.losses),
      ),
      el('div', { style:'display:grid;grid-template-columns:repeat(3,1fr);gap:8px' },
        statCard('Ничьи', stats.draws),
        statCard('Ср. ходы', stats.averageMoves),
        statCard('Винрейт', stats.winRate + '%'),
      ),
      // достижения
      el('div', {},
        el('div', { style:'font-weight:700;margin-bottom:6px' }, 'Достижения'),
        achs.items.length
          ? el('div', { style:'display:flex;flex-wrap:wrap;gap:8px' },
              ...achs.items.map(t => el('span', { class:'btn', style:'cursor:default' }, '🏅 ' + sanitize(t))))
          : el('div', { style:'color:var(--muted)' }, 'Пока нет')
      ),
      buildProfileNotes(serverResult)
    );

    setModalContent(wrap);
  });

  return {
    setMode,
    onAction(cb){ onAction = cb; },
  };
}

// helpers

function sanitize(s){ const d=document.createElement('div'); d.textContent=String(s??''); return d.textContent; }

function statCard(label, value){
  return el('div', { style:'border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center' },
    el('div', { style:'font-size:12px;color:var(--muted)' }, sanitize(label)),
    el('div', { style:'font-weight:800;font-size:16px' }, String(value ?? 0))
  );
}

function mergeStatsSummary(serverStats){
  const sys = window.statsSystem;
  const summary = (sys && typeof sys.getStatsSummary === 'function') ? sys.getStatsSummary() : {};
  const raw = sys?.stats || {};

  const local = {
    gamesPlayed: raw.gamesPlayed ?? summary.gamesPlayed ?? 0,
    wins: raw.gamesWon ?? summary.wins ?? 0,
    losses: raw.gamesLost ?? summary.losses ?? 0,
    draws: raw.gamesDrawn ?? summary.draws ?? summary.totalDraws ?? 0,
    winRate: typeof summary.winRate === 'number'
      ? summary.winRate
      : (typeof sys?.getWinRate === 'function' ? sys.getWinRate() : 0),
    averageMoves: typeof summary.averageMoves === 'number'
      ? summary.averageMoves
      : (typeof sys?.getAverageMovesPerGame === 'function' ? sys.getAverageMovesPerGame() : 0),
  };

  const remote = serverStats || null;
  const remoteWinRate = (remote && typeof remote.win_rate === 'number') ? remote.win_rate : null;

  return {
    gamesPlayed: (remote && typeof remote.games_played === 'number') ? remote.games_played : local.gamesPlayed,
    wins: (remote && typeof remote.wins === 'number') ? remote.wins : local.wins,
    losses: (remote && typeof remote.losses === 'number') ? remote.losses : local.losses,
    draws: (remote && typeof remote.draws === 'number') ? remote.draws : local.draws,
    winRate: remoteWinRate ?? local.winRate,
    averageMoves: local.averageMoves,
  };
}

function safeAchievements(){
  const name = (window.me && window.me.name) ? window.me.name : 'Player';
  const avatar = (window.me && window.me.avatar) ? window.me.avatar : '';

  let items = [];
  try {
    const a = window.achievementSystem;
    if (a) {
      // пробуем распространённые варианты API
      if (typeof a.getUnlocked === 'function') items = a.getUnlocked().map(x => x.title || x.name || String(x));
      else if (Array.isArray(a.unlocked)) items = a.unlocked.map(x => x.title || x.name || String(x));
      else if (Array.isArray(a.list)) items = a.list.filter(x => x.unlocked).map(x => x.title || x.name || String(x));
    }
  } catch { items = []; }

  // фолбэк: показываем минимум
  if (!Array.isArray(items)) items = [];
  return { name, avatar, items };
}

async function fetchProfileFromServer(){
  const id = window.me?.id;
  if (!isNumericId(id)) return { profile: null, error: null };
  try {
    const r = await fetch(`/profile/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    return { profile: data?.profile ?? null, error: null };
  } catch (error) {
    return { profile: null, error };
  }
}

function isNumericId(id){
  return typeof id === 'string' ? /^[0-9]+$/.test(id) : Number.isFinite(id);
}

function buildProfileNotes(serverResult){
  if (!serverResult) return el('div', {});
  if (serverResult.error) {
    return el('div', { style:'color:var(--warn);font-size:12px' }, 'Не удалось загрузить статистику с сервера. Показаны локальные данные.');
  }
  if (!serverResult.profile && isNumericId(window.me?.id)) {
    return el('div', { style:'color:var(--muted);font-size:12px' }, 'Сыграйте первую игру, чтобы статистика появилась в рейтинге.');
  }
  return el('div', {});
}

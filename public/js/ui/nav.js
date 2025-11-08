import { $, el, me } from '../state.js';
import { showModal, hideModal, setModalContent } from './modal.js';
import { statsSystem } from '../stats.js';

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

  // === ПРОФИЛЬ: данные из сервера ===
  $('#tabProfile', nav).addEventListener('click', async () => {
    showModal('Профиль', 'Загрузка…', { label:'Ок', onClick:()=>hideModal() }, { show:false });

    const profileResult = await statsSystem.loadProfile({ force: true });
    const stats = profileResult?.summary || {};
    const profile = profileResult?.profile || null;

    const fallbackName = (me?.username && me.username.trim()) ? `@${me.username.replace(/^@/, '')}` : (me?.name || 'Профиль');
    const displayName = sanitize(profile?.username || fallbackName);
    const avatarSrc = profile?.avatar_url || me?.avatar || 'img/logo.svg';

    const infoSection = el('div', { style:'display:flex;gap:10px;align-items:center' },
      el('img', {
        src: avatarSrc,
        alt: displayName,
        style:'width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid var(--line)'
      }),
      el('div', { style:'display:flex;flex-direction:column;gap:4px' },
        el('div', { style:'font-weight:800;font-size:16px' }, displayName),
        profile?.updated_at
          ? el('div', { style:'font-size:12px;color:var(--muted)' }, `Обновлено: ${formatDate(profile.updated_at)}`)
          : null
      )
    );

    const statsGrid = el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px' },
      statCard('Игры', stats.gamesPlayed),
      statCard('Победы', stats.wins),
      statCard('Поражения', stats.losses),
      statCard('Ничьи', stats.draws),
      statCard('Винрейт', `${stats.winRate ?? 0}%`),
    );

    const achievementsBlock = el('div', {},
      el('div', { style:'font-weight:700;margin-bottom:6px' }, 'Достижения'),
      el('div', { style:'color:var(--muted)' }, 'Синхронизация достижений появится позже.')
    );

    const wrap = el('div', { style:'display:flex;flex-direction:column;gap:12px' },
      infoSection,
      statsGrid,
      achievementsBlock,
      buildProfileNotes(profileResult)
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
    el('div', { style:'font-weight:800;font-size:16px' }, sanitize(value ?? 0))
  );
}

function formatDate(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  } catch {
    return '';
  }
}

function isNumericId(id){
  return typeof id === 'string' ? /^[0-9]+$/.test(id) : Number.isFinite(id);
}

function buildProfileNotes(serverResult){
  if (!serverResult) return el('div', {});
  if (serverResult.error) {
    return el('div', { style:'color:var(--warn);font-size:12px' }, 'Не удалось загрузить статистику с сервера. Повторите попытку позже.');
  }
  if (!serverResult.profile && isNumericId(window.me?.id)) {
    return el('div', { style:'color:var(--muted);font-size:12px' }, 'Сыграйте первую игру, чтобы увидеть статистику.');
  }
  return el('div', {});
}

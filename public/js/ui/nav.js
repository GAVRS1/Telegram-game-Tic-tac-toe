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

    const statsGrid = el('div', { class: 'profile-section stats-grid' },
      statCard('Игры', stats.gamesPlayed),
      statCard('Победы', stats.wins),
      statCard('Поражения', stats.losses),
      statCard('Ничьи', stats.draws),
      statCard('Винрейт', `${stats.winRate ?? 0}%`),
    );

    const achievements = Array.isArray(profile?.achievements) ? profile.achievements : [];
    const achievementsBlock = buildAchievementsSection(achievements);

    const wrap = el('div', { class: 'profile-modal-content' },
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
  return el('div', { class: 'stat-card' },
    el('div', { class: 'stat-label' }, sanitize(label)),
    el('div', { class: 'stat-value' }, sanitize(value ?? 0))
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

function buildAchievementsSection(list) {
  const unlocked = list.filter(item => item?.unlocked).length;
  const total = list.length;

  const header = el('div', { class: 'achievements-header' },
    el('div', { class: 'section-title' }, 'Достижения'),
    total > 0
      ? el('div', { class: 'achievement-count' }, `${unlocked}/${total}`)
      : null
  );

  if (!total) {
    return el('div', { class: 'profile-section achievements-section' },
      header,
      el('div', { class: 'achievements-empty' }, 'Сыграйте несколько игр, чтобы открыть достижения.')
    );
  }

  const cards = list.map(item => achievementCard(item));
  return el('div', { class: 'profile-section achievements-section' },
    header,
    el('div', { class: 'achievements-grid' }, ...cards)
  );
}

function achievementCard(achievement) {
  const percent = Math.max(0, Math.min(100, Number(achievement?.percent ?? 0)));
  const requiresGames = Number(achievement?.requiresGames ?? 0);
  const progressDisplay = formatAchievementProgress(achievement);
  const unlocked = !!achievement?.unlocked;

  const card = el('div', { class: `achievement-card${unlocked ? ' is-unlocked' : ''}` },
    el('div', { class: 'achievement-icon-frame' },
      el('div', { class: 'achievement-icon' }, sanitize(achievement?.icon || '🎯'))
    ),
    el('div', { class: 'achievement-body' },
      el('div', { class: 'achievement-title-row' },
        el('div', { class: 'achievement-name' }, sanitize(achievement?.name || 'Достижение')),
        el('div', { class: `achievement-difficulty ${sanitizeClass(achievement?.difficulty)}` },
          formatDifficulty(achievement?.difficulty)
        )
      ),
      el('div', { class: 'achievement-description' }, sanitize(achievement?.description || '')),
      el('div', { class: 'achievement-progress' },
        el('div', { class: 'achievement-progress-bar' },
          el('div', { class: 'achievement-progress-fill', style: `width:${percent}%` })
        ),
        el('div', { class: 'achievement-progress-text' }, progressDisplay)
      ),
      (!achievement?.requirementMet && requiresGames > 0)
        ? el('div', { class: 'achievement-hint' }, `Доступно после ${requiresGames} игр`)
        : null,
      unlocked && achievement?.unlocked_at
        ? el('div', { class: 'achievement-hint unlocked-hint' }, `Открыто: ${formatDate(achievement.unlocked_at)}`)
        : null
    )
  );

  return card;
}

function formatAchievementProgress(achievement) {
  if (!achievement) return '';
  const target = Number(achievement.target ?? 0);
  if (achievement.metric === 'win_rate') {
    const progressValue = Math.min(100, Math.round(Number(achievement.progress ?? 0)));
    return `${progressValue}% / ${target}%`;
  }
  const progressValue = Math.max(0, Math.round(Number(achievement.progress ?? 0)));
  const capped = target > 0 ? Math.min(progressValue, target) : progressValue;
  return `${capped} / ${target}`;
}

function sanitizeClass(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
}

function formatDifficulty(value) {
  const difficulty = String(value || '').toLowerCase();
  switch (difficulty) {
    case 'bronze':
      return 'Bronze';
    case 'silver':
      return 'Silver';
    case 'gold':
      return 'Gold';
    case 'platinum':
      return 'Platinum';
    default:
      return '—';
  }
}

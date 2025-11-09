let telegramApp = null;
let telegramInitialized = false;

function initTelegram(tg) {
  if (!tg || telegramInitialized) return;
  try {
    tg.expand();
    tg.ready();
    tg.enableClosingConfirmation();
    tg.setHeaderColor(tg.colorScheme === 'dark' ? '#0f172a' : '#ffffff');
    tg.setBackgroundColor(tg.colorScheme === 'dark' ? '#0b1220' : '#f8fafc');
  } catch {}
  telegramInitialized = true;
}

export function getTelegramWebApp() {
  if (typeof window === 'undefined') return telegramApp;
  const current = window.Telegram?.WebApp;
  if (current) {
    telegramApp = current;
    initTelegram(current);
  }
  return telegramApp;
}

function getTelegramUser() {
  return getTelegramWebApp()?.initDataUnsafe?.user || null;
}

const APP_NAME = 'TicTacToeTWA';

getTelegramWebApp();

const initialTelegramUser = getTelegramUser();

function fullName(u) {
  if (!u) return 'Player';
  const f = (u.first_name || u.firstName || '').trim();
  const l = (u.last_name  || u.lastName  || '').trim();
  const un = (u.username || u.user_name || '').trim();
  const name = (f || l) ? `${f}${l ? ' ' + l : ''}`.trim() : (un || 'Player');
  return name || 'Player';
}

function cleanUsername(u){
  return (u || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
}

const uid = (() => {
  const fromTG = initialTelegramUser?.id;
  if (fromTG) return String(fromTG);
  const key = `${APP_NAME}:uid:session`;
  let v = sessionStorage.getItem(key);
  if (!v) { v = 'u_' + Math.random().toString(36).slice(2); sessionStorage.setItem(key, v); }
  return String(v);
})();

export const me = {
  id: uid,
  name: fullName(initialTelegramUser) || localStorage.getItem(`${APP_NAME}:name`) || 'Player',
  avatar: initialTelegramUser?.photo_url || localStorage.getItem(`${APP_NAME}:avatar`) || '',
  username: cleanUsername(initialTelegramUser?.username || initialTelegramUser?.user_name || ''),
};

if (typeof window !== 'undefined') {
  window.me = me;
}

try {
  localStorage.setItem(`${APP_NAME}:name`, me.name);
  if (me.avatar) localStorage.setItem(`${APP_NAME}:avatar`, me.avatar);
} catch {}

export function refreshIdentity() {
  const u = getTelegramUser();
  const nextId = u?.id ? String(u.id) : null;
  const nextName = fullName(u);
  const nextAva  = u?.photo_url || me.avatar || '';
  const nextUsername = cleanUsername(u?.username || u?.user_name || '');
  let changed = false;

  if (nextId && nextId !== me.id) {
    me.id = nextId;
    changed = true;
    try { sessionStorage.setItem(`${APP_NAME}:uid:session`, me.id); } catch {}
  }
  if (nextName && nextName !== me.name) { me.name = nextName; changed = true; }
  if (nextAva  && nextAva  !== me.avatar) { me.avatar = nextAva; changed = true; }
  if (nextUsername !== undefined && nextUsername !== me.username) { me.username = nextUsername; changed = true; }

  try {
    if (changed) {
      localStorage.setItem(`${APP_NAME}:name`, me.name);
      if (me.avatar) localStorage.setItem(`${APP_NAME}:avatar`, me.avatar);
    }
  } catch {}

  return changed;
}

export const $ = (sel, root=document) => root.querySelector(sel);
export function el(tag, props={}, ...children){
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k,v]) => {
    if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v, {passive:true});
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  });
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
    else node.appendChild(c);
  }
  return node;
}

export const WIN_PHRASES = [
  "Поздравляем! Вы сыграли мощно 👑",
  "Отличная победа! Так держать 🚀",
  "Браво! Красиво переиграли соперника 🏆",
  "Победа за вами! Скилл на месте 🔥",
];
export const LOSE_PHRASES = [
  "Ничего страшного, получится в следующий раз! 💪",
  "Хорошая попытка! Ещё немного — и победа будет ваша ✨",
  "Не сдавайтесь — следующий матч за вами 💥",
  "Сильная игра! Чуть-чуть не хватило, но всё впереди 🧠",
];
export const DRAW_PHRASES = [
  "Отличный матч! Вы держались на равных 🤝",
  "Крутая заруба — никто не уступил! ⚖️",
  "Это была достойная ничья. До новой встречи! 🎲",
  "Ни шагу назад! Равная борьба до конца 💫",
];
export const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];

export function vibrate(ms=15){ try { navigator.vibrate?.(ms); } catch {} }
export const clickAudio = (() => {
  const a = new Audio();
  try { a.src = 'data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA'; } catch {}
  return { play:()=>{ try{ a.currentTime=0; a.play(); }catch{} } };
})();

export const Game = {
  gameId: null,
  you: null,
  turn: 'X',
  board: Array(9).fill(null),
  opp: null,
  lastOpp: null,

  myMoveAllowed(){ return this.you && this.you === this.turn && !!this.gameId; },
  resetBoard(){ this.board = Array(9).fill(null); this.turn = 'X'; },
  resetAll(){ this.gameId = null; this.you = null; this.opp = null; this.resetBoard(); }
};

export async function computeWsUrl() {
  let wsUrl = location.origin.replace(/^http/, 'ws');
  try {
    const cfg = await (window.__CFG__ || Promise.resolve({}));
    if (cfg?.wsUrl) wsUrl = cfg.wsUrl;
  } catch {}
  return wsUrl;
}

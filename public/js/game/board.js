import { $, el, me, Game, vibrate, clickAudio, getTelegramWebApp } from '../state.js';
import { hideModal } from '../ui/modal.js';
import { sendWs } from '../ws.js';
import { statsSystem } from '../stats.js';

let statusEl, youAva, youName, youUsername, youMark, oppAva, oppName, oppUsername, oppMark, boardEl;
const cells = [];
let lastMoveTs = 0;

function setStatus(text, blink=false){
  statusEl.textContent = text;
  statusEl.classList.toggle('blink', !!blink);
}

function setTurnBar(_yourTurn){ /* no-op */ }

function applyNames(){
  const myName = (me.name && me.name.trim()) ? me.name : 'Вы';
  const myUsername = (me.username && me.username.trim()) ? '@' + me.username.replace(/^@/, '') : '';
  youName.textContent = myName;
  youName.title = myUsername ? `${myName} (${myUsername})` : myName;
  youName.setAttribute('aria-label', myName);
  youAva.src = me.avatar || 'img/logo.svg';
  youAva.alt = myName;
  youUsername.textContent = myUsername;
  youUsername.style.display = myUsername ? 'block' : 'none';

  let oppLabel = 'Оппонент';
  let oppAvaSrc = 'img/logo.svg';
  let oppUsernameLabel = ''; 
  if (Game.opp && String(Game.opp.id) !== String(me.id)) {
    const rawName = Game.opp.name && Game.opp.name.trim();
    const rawUsername = Game.opp.username && Game.opp.username.trim();
    oppUsernameLabel = rawUsername ? '@' + rawUsername.replace(/^@/, '') : '';
    oppLabel = rawName || oppUsernameLabel || 'Оппонент';
    oppAvaSrc = Game.opp.avatar || 'img/logo.svg';
  }
  oppName.textContent = oppLabel;
  oppName.title = oppUsernameLabel && oppUsernameLabel !== oppLabel
    ? `${oppLabel} (${oppUsernameLabel})`
    : oppLabel;
  oppName.setAttribute('aria-label', oppLabel);
  oppAva.src = oppAvaSrc;
  oppAva.alt = oppLabel;
  if (oppUsername) {
    oppUsername.textContent = oppUsernameLabel;
    oppUsername.style.display = oppUsernameLabel ? '' : 'none';
  }

  youMark.textContent = Game.you || '—';
  oppMark.textContent = Game.you ? (Game.you === 'X' ? 'O' : 'X') : '—';
  youMark.className = 'mark ' + (Game.you==='X' ? 'x':'o');
  oppMark.className = 'mark ' + (Game.you==='X' ? 'o':'x');
}

function renderBoard(){
  for (let i=0;i<9;i++){
    const v = Game.board[i];
    const cell = cells[i];
    cell.textContent = v ? v : '';
    cell.className = 'cell' + (v ? (' ' + v.toLowerCase()) : '');
    const can = !v && Game.myMoveAllowed();
    cell.classList.toggle('disabled', !can);
  }
  applyNames();
}

function onCellClick(i){
  if (!Game.gameId || !Game.myMoveAllowed() || Game.board[i]) return;

  const now = Date.now();
  const dt = lastMoveTs ? (now - lastMoveTs) : 0;
  lastMoveTs = now;

  vibrate(10);
  clickAudio.play();

  statsSystem.recordMove(i);
  sendWs({ t:'game.move', gameId: Game.gameId, i });
}

export function mountBoard(root){
  const wrap = el('div', { class:'wrap' },
    el('div', { class:'card' },
      el('div', { class:'badges' },
        el('div', { class:'badge', id:'youBadge' },
          el('div', { class:'info' },
            el('img', { class:'ava', id:'youAva', src: me.avatar || 'img/logo.svg' }),
            el('div', { class:'text' },
              el('span', { class:'name', id:'youName' }, me.name || 'Вы'),
              el('span', { class:'username', id:'youUsername' })
            )
          ),
          el('span', { class:'mark x', id:'youMark' }, '—')
        ),
        el('div', { class:'badge', id:'oppBadge' },
          el('div', { class:'info' },
            el('img', { class:'ava', id:'oppAva', src:'img/logo.svg' }),
            el('div', { class:'text' },
              el('span', { class:'name', id:'oppName' }, 'Оппонент'),
              el('span', { class:'username', id:'oppUsername' })
            )
          ),
          el('span', { class:'mark o', id:'oppMark' }, '—')
        )
      ),
      el('div', { class:'status-line', id:'status' }, 'Готово'),
      el('div', { class:'board', id:'board' })
    )
  );
  root.appendChild(wrap);

  const authorBadge = el('button', { class:'author-badge', type:'button', title:'Автор 0xGavrs' },
    el('img', { src:'https://t.me/i/userpic/320/rsgavrs.jpg', alt:'0xGavrs', loading:'lazy' }),
    el('div', { style:'display:flex;flex-direction:column;align-items:flex-start;line-height:1.2' },
      el('span', {}, '0xGavrs'),
      el('small', {}, 'Автор игры')
    )
  );
  authorBadge.addEventListener('click', () => {
    const link = 'https://t.me/rsgavrs';
    try {
      if (TG?.openTelegramLink) TG.openTelegramLink(link);
      else window.open(link, '_blank', 'noopener');
    } catch {
      window.open(link, '_blank', 'noopener');
    }
  }, { passive:true });
  wrap.appendChild(authorBadge);

  const styleFix = document.createElement('style');
  styleFix.textContent = `
    .badge .name{display:inline-block!important;opacity:1!important;}
    .status-line{margin:10px 0 6px; text-align:center; font-weight:600; opacity:.9;}
  `;
  document.head.appendChild(styleFix);

  statusEl = $('#status', wrap);
  youAva = $('#youAva', wrap); youName = $('#youName', wrap); youUsername = $('#youUsername', wrap); youMark = $('#youMark', wrap);
  oppAva = $('#oppAva', wrap); oppName = $('#oppName', wrap); oppUsername = $('#oppUsername', wrap); oppMark = $('#oppMark', wrap);
  boardEl = $('#board', wrap);

  for (let i=0;i<9;i++){
    const c = el('button', { class:'cell shimmer', dataset:{i} }, '');
    c.addEventListener('click', () => onCellClick(i), {passive:true});
    boardEl.appendChild(c); cells.push(c);
  }
  setStatus('Готово');
}

export function clearHighlights(){ [...document.querySelectorAll('.cell')].forEach(c => c.classList.remove('win')); }
export function highlightWin(line){ if (line) line.forEach(i => document.querySelectorAll('.cell')[i]?.classList.add('win')); }

export function toLobby(){
  Game.resetAll();
  hideModal();
  setStatus('Готово');
  sendWs({ t:'queue.leave' });
  document.querySelectorAll('.cell').forEach(c => { c.textContent=''; c.className='cell'; });
  applyNames();
}

export const UI = { renderBoard, applyNames, setStatus, setTurnBar };

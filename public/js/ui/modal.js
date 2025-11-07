import { $, el } from '../state.js';

let modal, modalTitle, modalBody, modalPrimary, modalSecondary;

function ensureModal() {
  if (modal) return;
  modal = el('div', { class:'modal', id:'modal' },
    el('div', { class:'box' },
      el('h3', { id:'modalTitle' }, 'Игра завершена'),
      el('div', { class:'body', id:'modalBody' },
        el('p',  { id:'modalText'  }, 'Результат')
      ),
      el('div', { class:'row', style:'justify-content:center; gap:10px' },
        el('button', { class:'btn primary', id:'modalPrimary' }, 'ОК'),
        el('button', { class:'btn', id:'modalSecondary' }, 'Закрыть')
      )
    )
  );
  (document.getElementById('app') || document.body).appendChild(modal);
  modalTitle = $('#modalTitle', modal);
  modalBody  = $('#modalBody', modal);
  modalPrimary = $('#modalPrimary', modal);
  modalSecondary = $('#modalSecondary', modal);
}

export function setModalContent(content) {
  ensureModal();
  modalBody.innerHTML = '';

  if (Array.isArray(content)) {
    content.forEach((node) => {
      if (typeof Node !== 'undefined' && node instanceof Node) modalBody.appendChild(node);
      else if (node != null) modalBody.appendChild(el('p', {}, String(node)));
    });
    return;
  }

  if (typeof Node !== 'undefined' && content instanceof Node) {
    modalBody.appendChild(content);
    return;
  }

  const textNode = el('p', { class:'modal-text' }, String(content ?? ''));
  modalBody.appendChild(textNode);
}

export function showModal(title, text, primaryCfg={}, secondaryCfg={}) {
  ensureModal();
  modalTitle.textContent = title ?? 'Сообщение';
  setModalContent(text ?? '');

  const { label:pl='ОК', onClick:po=()=>{}, show:ps=true } = primaryCfg || {};
  const { label:sl='Закрыть', onClick:so=()=>hideModal(), show:ss=true } = secondaryCfg || {};
  modalPrimary.textContent = pl;
  modalPrimary.onclick = () => po();
  modalSecondary.textContent = sl;
  modalSecondary.onclick = () => so();

  modalPrimary.style.display = ps ? '' : 'none';
  modalSecondary.style.display = ss ? '' : 'none';

  modal.classList.add('show');
}

export function hideModal(){
  ensureModal();
  modal.classList.remove('show');
}

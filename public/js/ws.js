import { computeWsUrl } from './state.js';

let socket = null;
let retries = 0;
let connecting = false;

export async function openWs(onOpen, onMessage, onClose){
  const url = await computeWsUrl();

  const connect = () => {
    if (connecting) return;
    connecting = true;

    try {
      socket = new WebSocket(url);

      socket.addEventListener('open',   () => {
        connecting = false;
        retries = 0;
        onOpen?.();
      });

      socket.addEventListener('message',(e)=> {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        onMessage?.(msg);
      });

      socket.addEventListener('close',  () => {
        onClose?.();
        connecting = false;
        const delay = Math.min(1000 * 2 ** retries++, 15000);
        setTimeout(connect, delay);
      });

      socket.addEventListener('error',  () => {});
    } catch {
      connecting = false;
      const delay = Math.min(1000 * 2 ** retries++, 15000);
      setTimeout(connect, delay);
    }
  };

  connect();
}

export function sendWs(obj){
  try { socket?.readyState===1 && socket.send(JSON.stringify(obj)); } catch {}
}

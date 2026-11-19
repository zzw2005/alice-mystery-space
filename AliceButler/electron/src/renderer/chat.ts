export {};
const form = document.querySelector<HTMLFormElement>('form')!;
const input = document.querySelector<HTMLTextAreaElement>('textarea')!;
const send = document.querySelector<HTMLButtonElement>('#send')!;
const list = document.querySelector<HTMLElement>('#messages')!;
const status = document.querySelector<HTMLElement>('#status')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const pending = document.querySelector<HTMLElement>('#pending')!;
const error = document.querySelector<HTMLElement>('#error')!;
const empty = document.querySelector<HTMLElement>('#empty')!;
let signature = '';
let sending = false;
window.alice.onChat(data => {
  input.maxLength = data.tuning.maxMessageChars;
  status.textContent = '电脑分身 · ' + data.note;
  const connectionText = data.connected ? '已连接' : '重连中';
  if (connection.textContent !== connectionText) connection.textContent = connectionText;
  connection.dataset.connected = String(data.connected);
  const next = JSON.stringify(data.messages);
  if (signature !== next) {
    signature = next; list.replaceChildren();
    for (const message of data.messages) {
      const row = document.createElement('div'); row.className = 'row ' + (message.mine ? 'mine' : 'hers');
      const bubble = document.createElement('p'); bubble.className = 'bubble'; bubble.textContent = message.text;
      bubble.setAttribute('aria-label', (message.mine ? '主人：' : '艾莉丝：') + message.text);
      row.append(bubble); list.append(row);
    }
    empty.hidden = data.messages.length > 0;
    list.scrollTop = list.scrollHeight;
  }
  pending.textContent = data.pending.length ? data.pending[data.pending.length - 1].stage + '…' : '';
});
input.addEventListener('input', () => { send.disabled = sending || !input.value.trim(); });
async function submit(event: Event): Promise<void> {
  event.preventDefault(); const text = input.value;
  if (!text.trim() || sending) return;
  sending = true; send.disabled = true; error.textContent = '';
  try { await window.alice.send(text); if (input.value === text) input.value = ''; input.focus(); }
  catch (e) { error.textContent = '发送失败，请重试。' + (e instanceof Error ? e.message : ''); }
  finally { sending = false; send.disabled = !input.value.trim(); }
}
form.addEventListener('submit', submit);
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
document.querySelector('#close')!.addEventListener('click', () => window.alice.closeChat());
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.alice.closeChat(); });
window.addEventListener('focus', () => input.focus());
const grip = document.querySelector<HTMLButtonElement>('#resize')!;
let resize: { id: number; x: number; y: number; width: number; height: number } | undefined;
grip.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  grip.setPointerCapture(event.pointerId);
  resize = { id: event.pointerId, x: event.screenX, y: event.screenY, width: window.outerWidth, height: window.outerHeight };
});
grip.addEventListener('pointermove', event => {
  if (resize?.id !== event.pointerId) return;
  window.alice.resizeChat(resize.width + event.screenX - resize.x, resize.height + event.screenY - resize.y);
});
grip.addEventListener('lostpointercapture', () => { resize = undefined; });
grip.addEventListener('keydown', event => {
  const dx = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0;
  const dy = event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0;
  if (!dx && !dy) return;
  event.preventDefault();
  window.alice.resizeChat(window.outerWidth + dx, window.outerHeight + dy);
});
window.alice.ready('chat');

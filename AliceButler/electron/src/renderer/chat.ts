export {};
const form = document.querySelector<HTMLFormElement>('form')!;
const input = document.querySelector<HTMLTextAreaElement>('textarea')!;
const send = document.querySelector<HTMLButtonElement>('#send')!;
const list = document.querySelector<HTMLElement>('#messages')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pending = document.querySelector<HTMLElement>('#pending')!;
const error = document.querySelector<HTMLElement>('#error')!;
const empty = document.querySelector<HTMLElement>('#empty')!;
let signature = '';
window.alice.onChat(data => {
  input.maxLength = data.tuning.maxMessageChars;
  status.textContent = '电脑分身 · ' + data.note;
  const next = JSON.stringify(data.messages);
  if (signature !== next) {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < data.tuning.chatScrollPx;
    signature = next; list.replaceChildren();
    for (const message of data.messages) {
      const row = document.createElement('div'); row.className = 'row ' + (message.mine ? 'mine' : 'hers');
      const bubble = document.createElement('p'); bubble.className = 'bubble'; bubble.textContent = message.text;
      bubble.setAttribute('aria-label', (message.mine ? '主人：' : '艾莉丝：') + message.text);
      row.append(bubble); list.append(row);
    }
    empty.hidden = data.messages.length > 0;
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  pending.textContent = data.pending.length ? data.pending[data.pending.length - 1].stage + '…' : '';
});
input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
async function submit(event: Event): Promise<void> {
  event.preventDefault(); const text = input.value;
  if (!text.trim() || send.disabled) return;
  send.disabled = true; error.textContent = '';
  try { await window.alice.send(text); input.value = ''; input.focus(); }
  catch (e) { error.textContent = '发送失败，请重试。' + (e instanceof Error ? e.message : ''); }
  finally { send.disabled = !input.value.trim(); }
}
form.addEventListener('submit', submit);
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
document.querySelector('#close')!.addEventListener('click', () => window.alice.closeChat());
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.alice.closeChat(); });
window.addEventListener('focus', () => input.focus());
window.alice.ready('chat');

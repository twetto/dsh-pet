export const companionPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-pet companion · GPT girl</title><link rel="stylesheet" href="/companion/style.css"></head>
<body><header><div><h1>GPT girl</h1><p>A little company, a continuing conversation.</p></div><span id="state">Connecting…</span></header>
<aside id="notice" role="status"></aside><main id="messages" aria-label="Conversation" aria-live="polite"></main>
<form id="chat"><label for="message">Talk to her</label><textarea id="message" maxlength="4000" rows="3" placeholder="What's on your mind?" required></textarea>
<div class="buttons"><small id="detail">Local history · Codex conversation</small><button type="button" id="stop" disabled>Stop</button><button id="send">Send</button></div></form>
<script src="/companion/chat.js"></script></body></html>`;

export const companionStyle = `
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#332c42;background:#faf8ff}
*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px 24px 16px;border-bottom:1px solid #e6dff1}
h1{font-size:21px;margin:0}header p{font-size:12px;color:#7c708d;margin:5px 0 0}#state{font-size:12px;color:#73588f}
aside{padding:0 24px;color:#865832;font-size:12px}aside:not(:empty){padding-top:12px}
main{flex:1;overflow-y:auto;padding:20px 24px;min-height:0}.empty{color:#8b7e9b;text-align:center;margin-top:22vh;font-size:14px}
article{margin:0 0 20px;max-width:94%;padding:14px 16px;border-radius:15px;background:#fff;border:1px solid #e9e2f1}
article.user{margin-left:auto;background:#eee6f8;border-color:#e2d6ef}article b{font-size:11px;color:#856d9b}article p{font-size:14px;line-height:1.65;margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
article small{display:block;color:#947451;font-size:10px;margin-top:5px}
form{padding:16px 24px 20px;border-top:1px solid #e6dff1}label{display:block;font-size:12px;margin-bottom:8px;color:#756486}
textarea{width:100%;resize:none;border:1px solid #d6c9e4;border-radius:12px;padding:12px;font:inherit;font-size:14px;color:inherit;background:white}textarea:focus{outline:2px solid #c7b0e0}
.buttons{display:flex;align-items:center;gap:8px;margin-top:10px}#detail{flex:1;color:#8b7e9b;font-size:10px;max-width:65%;overflow-wrap:anywhere}
button{border:0;border-radius:9px;padding:9px 16px;background:#8964ac;color:white;cursor:pointer}button:disabled{opacity:.45;cursor:default}#stop{background:#e9e1f2;color:#665176}
`;

export const companionScript = `
const messages = document.getElementById('messages');
const input = document.getElementById('message');
const send = document.getElementById('send');
const stop = document.getElementById('stop');
const notice = document.getElementById('notice');
let submitting = false;
let lastMessages = '';
let localError = '';
async function api(path, body) {
  const response = await fetch('/companion/' + path, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Local service unavailable');
  return result;
}
async function refresh() {
  try {
    const snapshot = await api('state');
    document.getElementById('state').textContent = snapshot.busy ? 'Thinking…' : snapshot.connected ? 'Here with you' : 'Ready · connects when you send';
    document.getElementById('detail').textContent = snapshot.threadId ? 'Saved thread · ' + snapshot.threadId.slice(0, 8) : 'New private conversation · read-only Codex';
    notice.textContent = localError || snapshot.notice;
    send.disabled = submitting || snapshot.busy;
    stop.disabled = !snapshot.busy;
    const serialized = JSON.stringify(snapshot.messages);
    if (serialized !== lastMessages) {
      const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      lastMessages = serialized;
      messages.replaceChildren();
      if (!snapshot.messages.length) {
        const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Say hello. We can pick up here next time.'; messages.append(empty);
      }
      for (const message of snapshot.messages) {
        const article = document.createElement('article'); article.className = message.role;
        const author = document.createElement('b'); author.textContent = message.role === 'user' ? 'YOU' : 'GPT GIRL';
        const text = document.createElement('p'); text.textContent = message.text || '…';
        article.append(author, text);
        if (message.status !== 'complete') { const state = document.createElement('small'); state.textContent = message.status; article.append(state); }
        messages.append(article);
      }
      if (follow) messages.scrollTop = messages.scrollHeight;
    }
  } catch { notice.textContent = 'Local service disconnected. Your saved history is retained.'; send.disabled = true; stop.disabled = true; }
}
document.getElementById('chat').addEventListener('submit', async event => {
  event.preventDefault(); if (send.disabled || !input.value.trim()) return;
  const text = input.value.trim(); submitting = true; send.disabled = true; localError = '';
  try { await api('message', { text, id: crypto.randomUUID() }); input.value = ''; }
  catch (error) { localError = error.message; }
  finally { submitting = false; await refresh(); input.focus(); }
});
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.getElementById('chat').requestSubmit(); } });
stop.addEventListener('click', async () => { try { await api('stop', {}); } catch (error) { localError = error.message; } });
async function poll() { await refresh(); setTimeout(poll, 700); }
poll(); input.focus();
`;

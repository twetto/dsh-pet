export const companionPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-pet companion · GPT girl</title><link rel="stylesheet" href="/companion/style.css"></head>
<body><header><div><h1>GPT girl</h1><p>A little company, a continuing conversation.</p></div><span id="state">Connecting…</span></header>
<aside id="notice" role="status"></aside><main id="messages" aria-label="Conversation" aria-live="polite"></main>
<form id="chat"><label for="message">Talk to her</label><textarea id="message" maxlength="4000" rows="3" placeholder="What's on your mind?" required></textarea>
<section id="image-tools" hidden aria-label="Image attachments"><p id="image-hint">Drop images here or paste with Ctrl+V · up to 4 images, 5 MiB each</p><div id="attachments" aria-live="polite"></div>
<details><summary>Attach an image path</summary><label for="image-path">Absolute image path</label><div class="path-row"><input id="image-path" type="text" placeholder="~/Pictures/example.png" autocomplete="off"><button type="button" id="attach-path" disabled>Attach</button></div></details></section>
<section id="remote-tools" hidden><p>Use Remote Control to upload images to this same conversation. New browser messages and images sync here when you return. Earlier missing history is not backfilled automatically. Remote access ends when you return or the service exits.</p><button type="button" id="remote-start" disabled>Upload images in browser</button> <a id="remote-open" hidden target="_blank" rel="noopener noreferrer">Open Remote Control</a> <button type="button" id="remote-return" hidden disabled>Return to chat</button><span id="remote-status" role="status"></span></section>
<div class="buttons"><small id="detail">Local history · Codex conversation</small><button type="button" id="stop" disabled>Stop</button><button id="send" disabled>Send</button></div></form>
<script src="/companion/chat.js"></script></body></html>`;

export const companionStyle = `
#remote-tools{font-size:11px;color:#756486;line-height:1.45;margin-top:8px}#remote-tools p{margin:6px 0}#remote-tools button{font-size:11px;padding:7px 9px}#remote-tools a{color:#73588f}#remote-status{display:block;margin-top:5px}#image-unavailable{font-size:11px;color:#756486}
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
#image-hint{font-size:11px;color:#756486;margin:8px 0}#attachments{display:flex;gap:8px;overflow-x:auto}.attachment{flex:0 0 92px;max-width:92px;margin:4px 0 8px}.attachment img{width:84px;height:70px;object-fit:contain;background:#eee;border-radius:6px}.attachment figcaption{font-size:10px;overflow-wrap:anywhere}.attachment button{font-size:10px;padding:3px 6px;margin-top:3px}
details{font-size:11px;color:#756486;margin:6px 0}summary{cursor:pointer}.path-row{display:flex;gap:6px}.path-row input{min-width:0;flex:1;padding:7px;border:1px solid #d6c9e4;border-radius:7px}.path-row button{font-size:11px;padding:6px 10px}article img.chat-image{display:block;max-width:100%;max-height:240px;object-fit:contain;margin-top:8px;border-radius:6px}body.dragover{outline:4px dashed #8964ac;outline-offset:-6px}
`;

export const companionScript = `
const messages = document.getElementById('messages');
const input = document.getElementById('message');
const send = document.getElementById('send');
const stop = document.getElementById('stop');
const notice = document.getElementById('notice');
const base = location.pathname.replace(/\\/$/, '');
const gemini = base === '/companion/gemini';
const claude = base === '/companion/claude';
const vision = !gemini;
const remoteStart = document.getElementById('remote-start');
const remoteReturn = document.getElementById('remote-return');
const remoteOpen = document.getElementById('remote-open');
document.getElementById('remote-tools').hidden = !gemini;
let remote = null;
let remotePending = false;
let hasThread = false;
const pending = [];
const historyImages = new Map();
let uploading = false;
let busy = false;
let online = false;
const pathInput = document.getElementById('image-path');
const attachPath = document.getElementById('attach-path');
document.getElementById('image-tools').hidden = !vision;
if (gemini) {
  const hint = document.createElement('p');
  hint.id = 'image-unavailable'; hint.textContent = 'Direct image attachments are unavailable here. Use Upload images in browser instead.';
  document.getElementById('image-tools').after(hint);
}
let submitting = false;
let lastMessages = '';
let localError = '';
function controls() {
  send.disabled = !online || submitting || busy || uploading || !!remote || remotePending;
  remoteStart.disabled = !online || !hasThread || submitting || busy || remotePending || !!remote;
  remoteStart.hidden = !!remote;
  remoteReturn.hidden = !remote;
  remoteReturn.disabled = !online || remotePending || remote?.status === 'starting' || remote?.status === 'stopping';
  remoteOpen.hidden = !remote?.url;
  if (remote?.url && remote.url.startsWith('https://antigravity.google.com/r/') && /^[0-9a-f-]+(?:-v2)?(?:[?]p=c%2F[0-9a-f-]+)?$/.test(remote.url.slice('https://antigravity.google.com/r/'.length))) remoteOpen.href = remote.url;
  else remoteOpen.removeAttribute('href');
  document.getElementById('remote-status').textContent = remotePending ? ' Working…' : remote ? ' Companion chat paused · ' + remote.status : !hasThread ? 'Send a message first to enable Remote Control.' : '';
  stop.disabled = !busy;
  attachPath.disabled = !online || submitting || busy || uploading;
  input.required = !pending.length;
  document.getElementById('image-hint').textContent = uploading ? 'Preparing image…' : 'Drop images here or paste with Ctrl+V · up to 4 images, 5 MiB each';
  for (const button of document.querySelectorAll('#attachments button')) button.disabled = !online || submitting || busy || uploading;
}
function imageElement(image) {
  const element = document.createElement('img');
  element.src = base + '/images/' + encodeURIComponent(image.id);
  element.alt = image.name;
  return element;
}
async function decodedImage(image) {
  try { await imageElement(image).decode(); return image; }
  catch {
    await api('images/remove', { id: image.id }).catch(() => {});
    throw new Error('This image could not be decoded. Try a valid PNG, JPEG, WebP or GIF.');
  }
}
function renderAttachments() {
  const container = document.getElementById('attachments'); container.replaceChildren();
  for (const image of pending) {
    const figure = document.createElement('figure'); figure.className = 'attachment';
    const caption = document.createElement('figcaption'); caption.textContent = image.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove ' + image.name);
    remove.addEventListener('click', async () => {
      if (send.disabled) return;
      uploading = true; controls();
      try { await api('images/remove', { id: image.id }); pending.splice(pending.indexOf(image), 1); }
      catch (error) { localError = error.message; notice.textContent = localError; }
      finally { uploading = false; renderAttachments(); }
    });
    figure.append(imageElement(image), caption, remove); container.append(figure);
  }
  controls();
}
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('Cannot read the dropped image.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file);
  });
}
async function attachFiles(files) {
  if (!vision || !online || submitting || busy || uploading) return;
  uploading = true; localError = ''; controls();
  try {
    for (const file of files) {
      if (pending.length >= 4) throw new Error('Attach up to four images per message.');
      if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Each image must be at most 5 MiB.');
      const image = await decodedImage(await api('images', { name: file.name || 'clipboard.png', data: await fileBase64(file) }));
      pending.push(image); renderAttachments();
    }
  } catch (error) { localError = error.message; notice.textContent = localError; }
  finally { uploading = false; renderAttachments(); }
}
async function attachImagePath(value) {
  if (!vision || !online || submitting || busy || uploading || !value.trim()) return;
  uploading = true; localError = ''; controls();
  try {
    if (pending.length >= 4) throw new Error('Attach up to four images per message.');
    pending.push(await decodedImage(await api('images/path', { path: value.trim() }))); pathInput.value = '';
  } catch (error) { localError = error.message; notice.textContent = localError; }
  finally { uploading = false; renderAttachments(); }
}
attachPath.addEventListener('click', () => attachImagePath(pathInput.value));
pathInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); attachImagePath(pathInput.value); } });
document.addEventListener('paste', event => {
  if (!vision) return;
  const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
  if (files.length) { event.preventDefault(); attachFiles(files); }
});
document.addEventListener('dragover', event => { event.preventDefault(); if (vision) { event.dataTransfer.dropEffect = 'copy'; document.body.classList.add('dragover'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dragover'); });
document.addEventListener('drop', event => {
  event.preventDefault(); document.body.classList.remove('dragover');
  if (!vision) { localError = 'Antigravity chat currently accepts text only; no image was sent.'; notice.textContent = localError; return; }
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length) attachFiles(files);
  else {
    const uri = (event.dataTransfer?.getData('text/uri-list') || '').split('\\n').map(line => line.trim()).find(line => line && !line.startsWith('#'));
    if (uri?.startsWith('file:')) attachImagePath(uri);
    else { localError = 'Drop a local image file, not a web link.'; notice.textContent = localError; }
  }
});
async function api(path, body) {
  const response = await fetch(base + '/' + path, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Local service unavailable');
  return result;
}
async function refresh() {
  try {
    const snapshot = await api('state');
    online = true;
    remote = snapshot.remoteControl || null; hasThread = !!snapshot.threadId;
    document.getElementById('state').textContent = remote ? 'Remote Control · chat paused' : snapshot.busy ? 'Thinking…' : snapshot.connected ? 'Here with you' : 'Ready · connects when you send';
    document.getElementById('detail').textContent = (gemini ? 'Antigravity · ' : claude ? 'Claude Code · ' : 'Codex · ') + (snapshot.threadId ? 'Saved thread · ' + snapshot.threadId.slice(0, 8) : 'New private conversation · chat only');
    notice.textContent = localError || snapshot.notice;
    busy = snapshot.busy; controls();
    const serialized = JSON.stringify(snapshot.messages);
    if (serialized !== lastMessages) {
      const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      lastMessages = serialized;
      messages.replaceChildren();
      const keepImages = new Set();
      if (!snapshot.messages.length) {
        const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Say hello. We can pick up here next time.'; messages.append(empty);
      }
      for (const message of snapshot.messages) {
        const article = document.createElement('article'); article.className = message.role;
        const author = document.createElement('b'); author.textContent = message.role === 'user' ? 'YOU' : gemini ? 'GEMINI' : claude ? 'CLAUDE' : 'GPT GIRL';
        const text = document.createElement('p'); text.textContent = message.text || '…';
        article.append(author, text);
        for (const image of message.images || []) {
          const key = message.id + ':' + image.id; keepImages.add(key);
          const preview = historyImages.get(key) || imageElement(image);
          preview.className = 'chat-image'; preview.loading = 'lazy'; historyImages.set(key, preview); article.append(preview);
        }
        if (message.status !== 'complete') { const state = document.createElement('small'); state.textContent = message.status; article.append(state); }
        messages.append(article);
      }
      for (const key of historyImages.keys()) if (!keepImages.has(key)) historyImages.delete(key);
      if (follow) messages.scrollTop = messages.scrollHeight;
    }
  } catch { online = false; notice.textContent = 'Local service disconnected. Your saved history is retained.'; controls(); stop.disabled = true; }
}
document.getElementById('chat').addEventListener('submit', async event => {
  event.preventDefault(); if (send.disabled || (!input.value.trim() && !pending.length)) return;
  const text = input.value.trim(); submitting = true; controls(); localError = '';
  try { await api('message', { text, id: crypto.randomUUID(), ...(vision ? { images: pending.map(image => image.id) } : {}) }); input.value = ''; pending.length = 0; renderAttachments(); }
  catch (error) { localError = error.message; }
  finally { submitting = false; controls(); await refresh(); input.focus(); }
});
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.getElementById('chat').requestSubmit(); } });
stop.addEventListener('click', async () => { try { await api('stop', {}); } catch (error) { localError = error.message; } });
remoteStart.addEventListener('click', async () => {
  if (remoteStart.disabled) return;
  remotePending = true; localError = ''; controls();
  try { await api('remote/start', {}); await refresh(); if (remoteOpen.hasAttribute('href')) remoteOpen.click(); }
  catch (error) { localError = error.message; }
  finally { remotePending = false; await refresh(); }
});
remoteReturn.addEventListener('click', async () => {
  if (remoteReturn.disabled) return;
  remotePending = true; localError = ''; controls();
  try { await api('remote/return', {}); }
  catch (error) { localError = error.message; }
  finally { remotePending = false; await refresh(); }
});
async function poll() { await refresh(); setTimeout(poll, 700); }
poll(); input.focus();
`;

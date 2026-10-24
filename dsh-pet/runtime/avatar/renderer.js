const bridge = window.avatarBridge;
const image = document.getElementById('avatar');
const error = document.getElementById('error');
const mask = document.createElement('canvas');
const context = mask.getContext('2d', { willReadFrequently: true });
let alpha;
let dragging = false;
let lastHit;
let lastPoint;
function hitTest(x, y) {
  if (!error.hidden) return true;
  if (!alpha) return false;
  const rect = image.getBoundingClientRect();
  const px = Math.floor(((x - rect.x) * mask.width) / rect.width);
  const py = Math.floor(((y - rect.y) * mask.height) / rect.height);
  // A tiny tolerance makes thin hair/edges easy to grab, while margins pass through.
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const sx = px + dx,
        sy = py + dy;
      if (sx >= 0 && sy >= 0 && sx < mask.width && sy < mask.height && alpha[(sy * mask.width + sx) * 4 + 3] > 24)
        return true;
    }
  return false;
}
function pointer(point) {
  lastPoint = point;
  const { x, y } = point;
  const hit = dragging || hitTest(x, y);
  if (hit !== lastHit) {
    lastHit = hit;
    bridge.hit(hit);
  }
}
async function show(value) {
  alpha = undefined;
  lastHit = undefined;
  error.hidden = true;
  document.body.dataset.avatar = value.id;
  document.body.dataset.ready = 'false';
  image.alt = value.label;
  image.title = value.label + '：左鍵拖曳、右鍵選單、雙擊聊天';
  image.src = value.url;
}
image.addEventListener('load', () => {
  try {
    mask.width = image.naturalWidth;
    mask.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
    alpha = context.getImageData(0, 0, mask.width, mask.height).data;
    document.body.dataset.ready = 'true';
    if (lastPoint) pointer(lastPoint);
  } catch {
    error.hidden = false;
    bridge.hit(true);
  }
});
image.addEventListener('error', () => {
  error.hidden = false;
  document.body.dataset.ready = 'error';
  bridge.hit(true);
});
window.addEventListener('pointermove', (event) => pointer({ x: event.clientX, y: event.clientY }));
window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !hitTest(event.clientX, event.clientY)) return;
  dragging = true;
  document.body.classList.add('dragging');
  event.target.setPointerCapture(event.pointerId);
  bridge.beginDrag();
});
function endDrag() {
  dragging = false;
  document.body.classList.remove('dragging');
  lastHit = undefined;
  bridge.endDrag();
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  endDrag();
  bridge.menu();
});
window.addEventListener('dblclick', () => bridge.openChat());
bridge.onPointer(pointer);
bridge.onChange(show);
bridge
  .configuration()
  .then(show)
  .catch(() => {
    error.hidden = false;
  });

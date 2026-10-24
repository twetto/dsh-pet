const { join } = require('node:path');
const avatars = Object.freeze({
  'gpt-girl': {
    label: 'GPT 龍娘',
    provider: 'codex',
    width: 364,
    height: 344,
    clip: 'gpt-girl/video-resolutions-v8/idle-loop-344-v8.webp',
  },
  'gemini-girl': {
    label: 'Gemini 貓娘',
    provider: 'agy',
    width: 325,
    height: 344,
    clip: 'gemini-girl/idle-processing-v1/resolutions/idle-loop-344-v8.webp',
  },
  'claude-girl': {
    label: 'Claude',
    provider: 'claude',
    width: 293,
    height: 344,
    clip: 'claude-girl/idle-processing-v1/resolutions/idle-loop-344-v8.webp',
  },
});
function avatarId(value = 'gpt-girl') {
  const id =
    { gpt: 'gpt-girl', codex: 'gpt-girl', gemini: 'gemini-girl', agy: 'gemini-girl', claude: 'claude-girl' }[value] ||
    value;
  if (!Object.hasOwn(avatars, id)) throw new Error('角色必須是 gpt、gemini 或 claude。');
  return id;
}
function clipPath(id) {
  return join(__dirname, '../../assets', avatars[avatarId(id)].clip);
}
function windowSize(id, height = 220) {
  const avatar = avatars[avatarId(id)];
  return { width: Math.round((height * avatar.width) / avatar.height) + 24, height: height + 24 };
}
function confine(bounds, area) {
  return {
    ...bounds,
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))),
  };
}
module.exports = { avatars, avatarId, clipPath, windowSize, confine };

function validAvatar(name) {
  return name === 'deepseek' || name === 'gpt-girl';
}

function animationFor(avatar, requested) {
  return avatar === 'gpt-girl' ? 'idle' : requested;
}

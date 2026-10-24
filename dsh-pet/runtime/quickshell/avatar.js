function validAvatar(name) {
  return name === 'deepseek' || name === 'gpt-girl' || name === 'gemini-girl' || name === 'claude-girl';
}

function animationFor(avatar, requested) {
  return avatar === 'deepseek' ? requested : 'idle';
}

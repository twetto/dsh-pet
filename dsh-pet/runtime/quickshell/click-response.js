function pickResponse(clips, previous, randomValue) {
  const choices = clips.filter((clip) => clip !== previous);
  if (choices.length === 0) return clips[0] || '';
  return choices[Math.floor(randomValue * choices.length)];
}

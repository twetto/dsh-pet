function breathing(phase) {
  const cycle = ((phase % 1) + 1) % 1;
  const progress = cycle < 0.38 ? cycle / 0.38 : (1 - cycle) / 0.62;
  return (1 - Math.cos(Math.PI * progress)) / 2;
}

function blinkDelay(randomValue) {
  return 2800 + Math.round(randomValue * 3200);
}

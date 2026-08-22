const countEl = document.getElementById('count');
const skipBtn = document.getElementById('skip');

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function render(s) {
  if (s.phase === 'break') countEl.textContent = fmt(s.remainingSec);
  // Any other phase: main.js destroys this window; nothing to do here.
}

/* Hold for 5 seconds to skip — enough friction to survive an idle impulse,
   short enough for a genuine emergency. */
let holdTimer = null;

function startHold() {
  skipBtn.classList.add('holding');
  holdTimer = setTimeout(() => window.rhythmFocus.skipBreak(), 5000);
}

function cancelHold() {
  skipBtn.classList.remove('holding');
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

skipBtn.addEventListener('pointerdown', startHold);
skipBtn.addEventListener('pointerup', cancelHold);
skipBtn.addEventListener('pointerleave', cancelHold);

window.rhythmFocus.onState(render);
(async () => {
  try {
    render(await window.rhythmFocus.getState());
  } catch {}
})();

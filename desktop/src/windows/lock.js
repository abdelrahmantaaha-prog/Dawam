/* The lock screen's whole vocabulary: open the planner, or hold to step out.
   The hold is measured here (2.5s of continuous press) and only then reported
   to the main process — releasing early resets, and a click does nothing. */
const HOLD_MS = 2500;
const btn = document.getElementById('hold-out');
const fill = btn.querySelector('.hold-fill');

document.getElementById('open-rhythm').addEventListener('click', () => {
  window.rhythmFocus.openPlanner();
});

let t0 = null;
let raf = null;

function tick() {
  const frac = Math.min(1, (Date.now() - t0) / HOLD_MS);
  fill.style.width = `${frac * 100}%`;
  if (frac >= 1) {
    t0 = null;
    fill.style.width = '0%';
    window.rhythmFocus.lockStepOut();
    return;
  }
  raf = requestAnimationFrame(tick);
}
function stop() {
  t0 = null;
  if (raf) cancelAnimationFrame(raf);
  fill.style.width = '0%';
}
btn.addEventListener('pointerdown', () => { t0 = Date.now(); raf = requestAnimationFrame(tick); });
btn.addEventListener('pointerup', stop);
btn.addEventListener('pointerleave', stop);
btn.addEventListener('pointercancel', stop);

/* The unlock minutes come from settings so the label tells the truth. */
window.rhythmFocus.getData().then((d) => {
  const m = (d.settings && d.settings.unlockMin) || 5;
  document.getElementById('hold-min').textContent = m;
});

const card = document.getElementById('card');
const taskEl = document.getElementById('task');
const subEl = document.getElementById('sub');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const openBtn = document.getElementById('openBtn');
const stdBtns = document.getElementById('stdBtns');
const askBtns = document.getElementById('askBtns');

let state = { phase: 'idle' };
let soundOn = true;

function render(s) {
  state = s;
  askBtns.hidden = !s.ask;
  stdBtns.hidden = !!s.ask;
  const active = s.phase !== 'idle';
  pauseBtn.hidden = !active;
  stopBtn.hidden = !active;
  pauseBtn.innerHTML = s.paused ? '&#9654;' : '&#10074;&#10074;';

  card.className = '';
  if (s.phase === 'idle') {
    card.classList.add('idle');
    taskEl.textContent = 'Ready to focus';
    subEl.textContent = 'Open Rhythm and pick a task';
    return;
  }

  if (s.paused) {
    card.classList.add('paused');
    taskEl.textContent = s.task;
    subEl.textContent = 'Paused';
  } else if (s.phase === 'break') {
    card.classList.add('break');
    taskEl.textContent = 'Break time';
    subEl.textContent = 'Stretch, hydrate, look away from the screen';
  } else if (s.drifting) {
    card.classList.add('drifting');
    taskEl.textContent = `Back to: ${s.task}`;
    subEl.textContent =
      s.enforceInSec != null
        ? `⚠ Off-task — force return in ${s.enforceInSec}s`
        : '⚠ You drifted — return to your task';
  } else {
    taskEl.textContent = s.task;
    subEl.textContent = `Focusing · round ${s.rounds + 1}`;
  }

  // A pending question takes over the card's text, whatever the state.
  if (s.ask) {
    card.classList.add('asking');
    taskEl.textContent = s.ask.label;
    subEl.textContent =
      s.drifting && s.enforceInSec != null
        ? `Forced back in ${s.enforceInSec}s…`
        : 'Work or distraction?';
  }
}

function beep() {
  if (!soundOn) return;
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.2);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {}
}

document.getElementById('askWork').addEventListener('click', () => {
  if (state.ask) window.rhythmFocus.triageVerdict(state.ask.key, 'work');
});
document.getElementById('askDist').addEventListener('click', () => {
  if (state.ask) window.rhythmFocus.triageVerdict(state.ask.key, 'distraction');
});
document.getElementById('askLater').addEventListener('click', () => {
  if (state.ask) window.rhythmFocus.triageSnooze(state.ask.key);
});

pauseBtn.addEventListener('click', () => (state.paused ? window.rhythmFocus.resume() : window.rhythmFocus.pause()));
stopBtn.addEventListener('click', () => window.rhythmFocus.stop());
openBtn.addEventListener('click', () => window.rhythmFocus.openPlanner());

window.rhythmFocus.onState(render);
window.rhythmFocus.onNudge(() => beep());
window.rhythmFocus.onDataChanged(async () => {
  const { settings } = await window.rhythmFocus.getData();
  soundOn = settings.nudgeSound;
});

(async () => {
  const { settings } = await window.rhythmFocus.getData();
  soundOn = settings.nudgeSound;
  render(await window.rhythmFocus.getState());
})();

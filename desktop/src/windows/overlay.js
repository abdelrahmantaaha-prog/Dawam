const card = document.getElementById('card');
const taskEl = document.getElementById('task');
const subEl = document.getElementById('sub');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const openBtn = document.getElementById('openBtn');

let state = { phase: 'idle' };

function render(s) {
  state = s;
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
  } else {
    taskEl.textContent = s.task;
    subEl.textContent = s.strict
      ? `Focusing · round ${s.rounds + 1} · only allowed windows`
      : `Focusing · round ${s.rounds + 1}`;
  }
}

pauseBtn.addEventListener('click', () => (state.paused ? window.rhythmFocus.resume() : window.rhythmFocus.pause()));
stopBtn.addEventListener('click', () => window.rhythmFocus.stop());
openBtn.addEventListener('click', () => window.rhythmFocus.openPlanner());

window.rhythmFocus.onState(render);

(async () => {
  render(await window.rhythmFocus.getState());
})();

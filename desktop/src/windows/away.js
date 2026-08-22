const FUNNIES = [
  'The chair reports a missing human.',
  'Your task did not stand up. Why did you?',
  'Standing desk? Nice try. That is not what this is.',
  'The Pomodoro timer is crying. It hates being alone.',
  'This chair has separation anxiety.',
  'Gravity works better when you use it.',
  'Focus mode, not cardio mode.',
  'Breaking news: local desk abandoned. Authorities concerned.',
  'The cursor is blinking at an empty room.',
  'Your coffee is getting suspicious.'
];

document.getElementById('funny').textContent =
  FUNNIES[Math.floor(Math.random() * FUNNIES.length)];

(async () => {
  try {
    const s = await window.rhythmFocus.getState();
    if (s.task) {
      document.getElementById('taskline').textContent = `"${s.task}" is waiting for you`;
    }
  } catch {}
})();

document.addEventListener('click', () => window.rhythmFocus.awayDismiss());
document.addEventListener('keydown', () => window.rhythmFocus.awayDismiss());

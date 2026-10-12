// The page that was refused rides in the address after '#'.
const target = decodeURIComponent(location.hash.slice(1));
let host = target;
try { host = new URL(target).hostname.replace(/^www\./, ''); } catch { /* show it as it came */ }
document.getElementById('site').textContent = host;
document.title = `${host} — outside the bubble`;
document.getElementById('back').addEventListener('click', () => history.back());
/* The worker asks Rhythm to let the site in. Rhythm then tells the worker the
   bubble changed, the rules widen, and render() below sees the page is
   allowed and goes to it. */
document.getElementById('add').addEventListener('click', async () => {
  const btn = document.getElementById('add');
  btn.disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 'add', url: target }).catch(() => null);
  if (!r || !r.ok) {
    btn.disabled = false;
    document.getElementById('note').textContent = 'Rhythm could not be reached to let it in. Is it running?';
  }
});

function render(bubble) {
  // The bubble ended, or changed to one this page belongs in: go to it.
  if (!bubble || !bubble.active || urlAllowed(target, bubble.rules)) {
    if (/^https?:/.test(target)) location.replace(target);
    return;
  }
  const left = bubble.endsAt ? ` · ${mmss(bubble.endsAt - Date.now())} left` : '';
  document.getElementById('sub').textContent = bubble.name
    ? `“${bubble.name}” keeps this closed until the round ends${left}.`
    : `The bubble you are in keeps this closed until the round ends${left}.`;
}

chrome.storage.session.get('bubble').then(({ bubble }) => render(bubble));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.bubble) render(changes.bubble.newValue);
});
// Keep the countdown moving, and make sure the worker is awake to hear the end.
setInterval(() => chrome.storage.session.get('bubble').then(({ bubble }) => render(bubble)), 1000);
chrome.runtime.sendMessage({ type: 'wake' }).catch(() => {});

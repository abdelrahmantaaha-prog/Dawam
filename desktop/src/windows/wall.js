const api = window.rhythmFocus;
const main = new URLSearchParams(location.search).get('main') === '1';
const $ = (id) => document.getElementById(id);

if (!main) document.body.classList.add('side');
for (const id of ['dock', 'actions', 'note', 'add', 'add-note']) $(id).hidden = !main;

const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// A site has no icon of its own here (nothing is fetched); it gets its letter
// on a colour of its own, the same colour every time.
function hue(text) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function tile(item) {
  const b = document.createElement('button');
  b.className = 'tile';
  b.title = item.kind === 'site' ? item.domain : (item.exe || item.name);
  if (item.icon) {
    const img = document.createElement('img');
    img.src = item.icon; img.alt = '';
    b.appendChild(img);
  } else {
    const l = document.createElement('span');
    l.className = 'letter';
    l.textContent = String(item.name || item.domain || '?').replace(/^www\./, '').charAt(0).toUpperCase();
    l.style.background = `hsl(${hue(item.domain || item.name)} 45% 38%)`;
    b.appendChild(l);
  }
  const n = document.createElement('span');
  n.className = 'name'; n.textContent = item.name || item.domain;
  b.appendChild(n);
  const k = document.createElement('span');
  k.className = 'kind'; k.textContent = item.kind === 'site' ? item.domain : 'app';
  b.appendChild(k);
  b.addEventListener('click', async () => {
    b.classList.add('busy');
    try { await api.bubble.open(item); } finally { setTimeout(() => b.classList.remove('busy'), 600); }
  });
  return b;
}

let shownKey = '';
async function renderDock(state) {
  if (!main) return;
  let items = await api.bubble.items();
  // A round started by an older planner carries no icons; its state still
  // knows the items.
  if (!items || !items.length) items = (state && state.items) || [];
  const key = JSON.stringify(items.map((i) => [i.kind, i.exe || i.domain || i.text, !!i.icon]));
  if (key === shownKey) return;
  shownKey = key;
  const dock = $('dock');
  dock.replaceChildren(...items.filter((i) => i.kind !== 'word').map(tile));
  const words = items.filter((i) => i.kind === 'word').map((i) => i.text);
  $('words').hidden = !words.length;
  $('words').textContent = words.length ? `Also open: anything that mentions ${words.join(', ')}` : '';
}

function render(s) {
  if (!s) return;
  $('bubble').textContent = s.bubbleName ? `In the ${s.bubbleName} bubble` : 'In a bubble';
  $('task').textContent = s.task || '';
  $('clock').textContent = mmss(s.remainingSec);
  const pct = s.totalSec ? Math.min(1, Math.max(0, 1 - s.remainingSec / s.totalSec)) : 0;
  $('bar').style.width = `${pct * 100}%`;
  document.body.classList.toggle('paused', !!s.paused);
  renderDock(s);
}

// The site goes in for the rest of the round, appears on the dock, and opens.
$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('add-site').value.trim();
  if (!v) return;
  const site = await api.bubble.addSite(v);
  if (!site) { $('add-note').textContent = 'That is not a site — type an address like arxiv.org.'; return; }
  $('add-site').value = '';
  $('add-note').textContent = `${site.domain} is in for this round.`;
  api.bubble.open(site);
});

$('planner').addEventListener('click', () => api.openPlanner());
$('browser').addEventListener('click', () => api.bubble.browser());

api.onState(render);
api.getState().then(render);

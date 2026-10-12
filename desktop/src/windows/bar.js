const api = window.rhythmFocus;
const $ = (id) => document.getElementById(id);
if (new URLSearchParams(location.search).get('vertical') === '1') document.body.classList.add('vertical');

const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const exeBase = (p) => String(p || '').toLowerCase().split(/[\\/]/).pop().replace(/\.exe$/, '');
const hue = (text) => { let h = 0; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

let items = [];
let running = new Set();   // program file names with a window open
let front = '';            // the program in front

function button(item) {
  const b = document.createElement('button');
  b.className = 'item';
  b.title = item.kind === 'site' ? `${item.name} — ${item.domain}` : item.name;
  if (item.icon) {
    b.appendChild(Object.assign(document.createElement('img'), { src: item.icon, alt: '' }));
  } else {
    const l = document.createElement('span');
    l.className = 'letter';
    l.textContent = String(item.name || item.domain || '?').replace(/^www\./, '').charAt(0).toUpperCase();
    l.style.background = `hsl(${hue(item.domain || item.name)} 45% 38%)`;
    b.appendChild(l);
  }
  b.addEventListener('click', () => api.bubble.open(item));
  b.dataset.exe = item.kind === 'app' ? exeBase(item.exe) : '';
  return b;
}

let shownKey = '';
async function renderItems(state) {
  let list = await api.bubble.items();
  if (!list || !list.length) list = (state && state.items) || [];
  list = list.filter((i) => i.kind !== 'word');
  const key = JSON.stringify(list.map((i) => [i.kind, i.exe || i.domain, !!i.icon]));
  if (key !== shownKey) {
    shownKey = key;
    items = list;
    $('items').replaceChildren(...items.map(button));
  }
  marks();
}

// Which of the bubble's apps are open, and which is in front.
function marks() {
  for (const b of $('items').children) {
    const exe = b.dataset.exe;
    b.classList.toggle('open', !!exe && running.has(exe));
    b.classList.toggle('front', !!exe && exe === front);
  }
}

function render(s) {
  if (!s) return;
  $('name').textContent = s.bubbleName || s.task || '';
  $('left').textContent = s.phase === 'work' ? `${mmss(s.remainingSec)} left` : '';
  document.body.classList.toggle('paused', !!s.paused);
  front = s.current ? exeBase(s.current.path || s.current.process) : '';
  renderItems(s);
}

function tick() {
  const d = new Date();
  $('time').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('date').textContent = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

$('rhythm').addEventListener('click', () => api.openPlanner());
$('files').addEventListener('click', () => api.bubble.openFiles());
$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('add-site');
  const v = input.value.trim();
  if (!v) return;
  const site = await api.bubble.addSite(v);
  input.classList.toggle('ok', !!site);
  input.classList.toggle('bad', !site);
  if (site) { input.value = ''; input.blur(); api.bubble.open(site); }
  setTimeout(() => input.classList.remove('ok', 'bad'), 1500);
});

api.onState(render);
api.bubble.onRunning((list) => { running = new Set(list); marks(); });
api.getState().then(render);
tick();
setInterval(tick, 1000 * 15);

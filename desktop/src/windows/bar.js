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

/* One button for every site in the bubble: a click opens the browser to work
   in, and resting on it opens a menu of the sites (bubbles.js, siteMenu). The
   sites are places inside the browser, not programs, so they do not each get
   a slot of their own. */
let browserIcon = null;
function browserButton(sites) {
  const b = document.createElement('button');
  b.className = 'item browser';
  b.title = `Browser — ${sites.map((s) => s.name || s.domain).join(', ')}`;
  b.innerHTML = browserIcon
    ? `<img src="${browserIcon}" alt="" />`
    : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#7FBFA4" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = sites.length;
  b.appendChild(count);
  let hover = null;
  const menu = () => {
    const r = b.getBoundingClientRect();
    api.bubble.siteMenu(document.body.classList.contains('vertical') ? { x: r.right, y: r.top } : { x: r.left, y: r.top });
  };
  b.addEventListener('mouseenter', () => { hover = setTimeout(menu, 350); });
  b.addEventListener('mouseleave', () => clearTimeout(hover));
  b.addEventListener('click', () => { clearTimeout(hover); api.bubble.openBrowserHome(); });
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(hover); menu(); });
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
    const apps = items.filter((i) => i.kind === 'app');
    const sites = items.filter((i) => i.kind === 'site');
    $('items').replaceChildren(...apps.map(button), ...(sites.length ? [browserButton(sites)] : []));
  }
  marks();
}

let lastState = null;
api.bubble.browserIcon().then((icon) => { browserIcon = icon; shownKey = ''; renderItems(lastState); }).catch(() => {});

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
  lastState = s;
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

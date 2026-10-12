const b = window.rhythmFocus.browser;
const $ = (id) => document.getElementById(id);
const address = $('address');
let tabs = [];

function renderTabs(list) {
  tabs = list;
  const nodes = list.map((t) => {
    const el = document.createElement('div');
    el.className = `tab${t.active ? ' on' : ''}${t.loading ? ' loading' : ''}`;
    el.title = t.title;
    if (t.favicon && !t.loading) {
      const img = document.createElement('img');
      img.src = t.favicon; img.alt = '';
      img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'dot' }));
      el.appendChild(img);
    } else {
      el.appendChild(Object.assign(document.createElement('span'), { className: 'dot' }));
    }
    el.appendChild(Object.assign(document.createElement('span'), { className: 't', textContent: t.title }));
    const x = Object.assign(document.createElement('button'), { className: 'x', textContent: '×', title: 'Close (Ctrl+W)' });
    x.addEventListener('click', (e) => { e.stopPropagation(); b.closeTab(t.id); });
    el.appendChild(x);
    el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); b.closeTab(t.id); } });
    el.addEventListener('click', () => b.activate(t.id));
    return el;
  });
  $('tablist').replaceChildren(...nodes);
  const cur = list.find((t) => t.active);
  // Never overwrite what someone is in the middle of typing.
  if (cur && document.activeElement !== address) address.value = /^file:/.test(cur.url) ? '' : cur.url;
  $('back').disabled = !(cur && cur.back);
  $('forward').disabled = !(cur && cur.forward);
}

function renderExtensions(list) {
  $('exts').replaceChildren(...list.map((x) => {
    const btn = Object.assign(document.createElement('button'), { className: 'ext', title: x.name });
    if (x.icon) btn.appendChild(Object.assign(document.createElement('img'), { src: x.icon, alt: '' }));
    else btn.appendChild(Object.assign(document.createElement('span'), { className: 'letter', textContent: x.name.charAt(0) }));
    btn.addEventListener('click', () => b.extensionPopup(x.id));
    return btn;
  }));
}

$('go').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = address.value.trim();
  if (v) b.navigate(v);
  address.blur();
});
address.addEventListener('focus', () => address.select());
$('back').addEventListener('click', () => b.back());
$('forward').addEventListener('click', () => b.forward());
$('reload').addEventListener('click', () => b.reload());
$('newtab').addEventListener('click', () => b.newTab());

b.onTabs(renderTabs);
b.onExtensions(renderExtensions);
b.onFocusAddress(() => address.focus());
b.ready();

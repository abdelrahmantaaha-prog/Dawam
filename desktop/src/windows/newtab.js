let items = [];
try { items = JSON.parse(new URLSearchParams(location.search).get('items') || '[]'); } catch { items = []; }

const sites = document.getElementById('sites');
for (const it of items) {
  const a = document.createElement('a');
  a.href = it.url;
  a.className = 'site-link';
  a.textContent = it.name;
  sites.appendChild(a);
}
document.getElementById('head').textContent = items.length ? 'Your bubble' : 'New tab';
document.getElementById('note').textContent = items.length
  ? 'Only these sites open in this round. Type an address above for one of them.'
  : 'Type an address above.';

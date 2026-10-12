function render({ bubble, connected }) {
  const head = document.getElementById('head');
  const sub = document.getElementById('sub');
  const list = document.getElementById('sites');
  list.replaceChildren();
  if (!connected) {
    head.textContent = 'Rhythm is not reachable';
    sub.textContent = 'Rhythm for Windows has to be running for bubbles to reach Brave. Brave is not being held to anything right now.';
    return;
  }
  if (!bubble || !bubble.active) {
    head.textContent = 'No bubble running';
    sub.textContent = 'Connected to Rhythm. When a bubble starts, only its sites will open here.';
    return;
  }
  head.textContent = bubble.name ? `In the ${bubble.name} bubble` : 'In a bubble';
  sub.textContent = `${bubble.task || ''}${bubble.endsAt ? ` · ${mmss(bubble.endsAt - Date.now())} left` : ''}`;
  for (const d of bubble.rules.domains || []) list.appendChild(Object.assign(document.createElement('li'), { textContent: d }));
  for (const k of bubble.rules.keywords || []) list.appendChild(Object.assign(document.createElement('li'), { textContent: `anything with “${k}”` }));
}

chrome.runtime.sendMessage({ type: 'wake' }).catch(() => {});
chrome.storage.session.get(['bubble', 'connected']).then(render);
chrome.storage.onChanged.addListener((_c, area) => {
  if (area === 'session') chrome.storage.session.get(['bubble', 'connected']).then(render);
});

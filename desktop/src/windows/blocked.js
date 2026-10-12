const q = new URLSearchParams(location.search);
const url = q.get('u') || '';
const name = q.get('name') || '';
document.getElementById('site').textContent = q.get('site') || url;
document.getElementById('sub').textContent = name
  ? `“${name}” keeps this page closed until the round ends.`
  : 'The bubble you are in keeps this page closed until the round ends.';
document.getElementById('back').addEventListener('click', () => history.length > 1 ? history.back() : null);
// Through the same gate as any other page: it opens only if it is allowed now.
document.getElementById('again').addEventListener('click', () => { if (url) location.href = url; });

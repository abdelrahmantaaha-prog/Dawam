/* The one rule, shared by the worker and the pages: may this address open in
   the bubble? The same decision Rhythm's own bubble browser makes (desktop/
   src/bubble.js, urlAllowed) — a site allows itself and everything under it,
   sign-in pages always load, and a keyword allows any address that says it. */

const bare = (h) => String(h || '').toLowerCase().replace(/^(www|m)\./, '');
const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/* A site as { name, port }. Local sites (this computer's own address) keep
   their port: 127.0.0.1:5400 is one app and 127.0.0.1:3000 another. */
function splitHost(h) {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(String(h || '').toLowerCase());
  if (!m) return { name: '', port: '' };
  const name = bare(m[1]);
  return { name: LOCAL.test(name) ? '127.0.0.1' : name, port: m[2] || '' };
}

function siteMatches(domain, host) {
  const d = splitHost(domain), h = splitHost(host);
  if (!h.name) return false;
  if (d.name === '127.0.0.1') return h.name === '127.0.0.1' && (!d.port || d.port === h.port);
  return h.name === d.name || h.name.endsWith(`.${d.name}`);
}

function urlAllowed(url, rules) {
  if (!rules) return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return true;
  const host = bare(u.hostname);
  const under = (d) => host === d || host.endsWith(`.${d}`);
  if ((rules.domains || []).some((d) => siteMatches(d, u.host))) return true;
  if ((rules.signIn || []).some(under)) return true;
  const hay = String(url).toLowerCase();
  return (rules.keywords || []).some((k) => k && hay.includes(k));
}

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

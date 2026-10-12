/* The one rule, shared by the worker and the pages: may this address open in
   the bubble? The same decision Rhythm's own bubble browser makes (desktop/
   src/bubble.js, urlAllowed) — a site allows itself and everything under it,
   sign-in pages always load, and a keyword allows any address that says it. */

const bare = (h) => String(h || '').toLowerCase().replace(/^(www|m)\./, '');

function urlAllowed(url, rules) {
  if (!rules) return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return true;
  const host = bare(u.hostname);
  const under = (d) => host === d || host.endsWith(`.${d}`);
  if ((rules.domains || []).some(under)) return true;
  if ((rules.signIn || []).some(under)) return true;
  const hay = String(url).toLowerCase();
  return (rules.keywords || []).some((k) => k && hay.includes(k));
}

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

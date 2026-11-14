/* ------------------------------------------------------------------ */
/*  The phone half of Tera, from the page's side.                      */
/*                                                                     */
/*  On Android every call goes to TeraPlugin (android/.../tera/). In   */
/*  a browser and on the desktop there is no plugin: the pop-ups do    */
/*  not exist there, and speech falls back to the browser's own        */
/*  speechSynthesis — whatever voices the system has, which for        */
/*  Egyptian Arabic is often none, so it may simply stay quiet.        */
/* ------------------------------------------------------------------ */
import { Capacitor, registerPlugin } from '@capacitor/core';

const Tera = registerPlugin('Tera');

export const teraNative = () => {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'; } catch { return false; }
};

const guard = async (fn, fallback = null) => {
  if (!teraNative()) return fallback;
  try { return await fn(); } catch (e) { console.warn('tera', e); return fallback; }
};

export const teraStatus = () => guard(() => Tera.status());
export const teraSync = (brief) => guard(() => Tera.sync({ brief }));
export const teraReportDone = (at = Date.now()) => guard(() => Tera.reportDone({ at }));
export const teraTakeCommands = async () => (await guard(() => Tera.takeCommands(), { commands: [] }))?.commands || [];
export const teraTestPopup = (kind = 'nag') => guard(() => Tera.testPopup({ kind }));
export const teraHideHead = () => guard(() => Tera.hideHead());
export const teraOpenOverlaySettings = () => guard(() => Tera.openOverlaySettings());
export const teraOpenExactAlarmSettings = () => guard(() => Tera.openExactAlarmSettings());

/* Commands queued from the floating face while the planner is running in the
   background arrive here at once. Returns an unsubscribe. */
export function onTeraCommand(cb) {
  if (!teraNative()) return () => {};
  let handle = null;
  let gone = false;
  Promise.resolve(Tera.addListener('command', cb)).then((h) => { if (gone) h.remove(); else handle = h; }).catch(() => {});
  return () => { gone = true; if (handle) handle.remove(); };
}

/* ---------- Speaking ---------- */

let webUtterance = null;

function webVoiceFor(lang) {
  const vs = (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices()) || [];
  const want = lang === 'ar' ? ['ar-EG', 'ar'] : ['en-US', 'en-GB', 'en'];
  for (const w of want) {
    const v = vs.find((x) => (x.lang || '').toLowerCase().startsWith(w.toLowerCase()));
    if (v) return v;
  }
  return null;
}

/* Resolves when she has finished (or was stopped), with the engine that
   spoke: 'edge' (the neural voice), 'device' (the phone's own TTS), 'web'
   (the browser's), or 'none'. */
export async function teraSpeak(text, lang) {
  if (!text || !String(text).trim()) return { engine: 'none' };
  if (teraNative()) {
    try { return await Tera.speak({ text, lang }); } catch (e) { return { engine: 'none', error: String(e?.message || e) }; }
  }
  if (typeof speechSynthesis === 'undefined') return { engine: 'none' };
  const voice = webVoiceFor(lang);
  if (!voice && lang === 'ar') return { engine: 'none' };
  return new Promise((resolve) => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.onend = () => resolve({ engine: 'web' });
      u.onerror = () => resolve({ engine: 'none' });
      webUtterance = u;
      speechSynthesis.speak(u);
    } catch { resolve({ engine: 'none' }); }
  });
}

export async function teraStopSpeaking() {
  if (teraNative()) { try { await Tera.stopSpeaking(); } catch { /* nothing playing */ } return; }
  try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* ignore */ }
  webUtterance = null;
}

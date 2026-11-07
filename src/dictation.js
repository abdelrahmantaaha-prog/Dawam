/* ------------------------------------------------------------------ */
/*  Dictation — speaking to Dawam, on a laptop and on a phone.        */
/*                                                                     */
/*  There is no single API that works in all three shells this app     */
/*  ships in, so there are two paths and one rule for choosing:        */
/*                                                                     */
/*    Web Speech    Chrome and Safari expose SpeechRecognition. It is  */
/*                  live (words appear as you say them), free, and     */
/*                  costs no model tokens. Where it exists, it wins.   */
/*                                                                     */
/*    Record+model  The Android WebView Capacitor runs in has no       */
/*                  SpeechRecognition at all. Electron is worse than   */
/*                  that: it DEFINES the interface and starts capture, */
/*                  then fails with error:network, because the         */
/*                  open-source Chromium it is built from carries no   */
/*                  credentials for Google's speech service. Measured, */
/*                  not assumed — desktop/mic-probe.mjs drives the     */
/*                  real window and logs                               */
/*                  "start -> audiostart -> error:network -> end".     */
/*                  Both of those record a clip and send it to Gemini, */
/*                  through the shared key pool when one is configured.*/
/*                                                                     */
/*  The second path is why the recorder does not just hand the         */
/*  MediaRecorder blob over: Chrome records `audio/webm;codecs=opus`,  */
/*  which is not one of the container formats the Gemini API lists as  */
/*  accepted. Decoding it and re-encoding 16 kHz mono WAV in the page  */
/*  is about forty lines and removes the whole question — and a        */
/*  spoken sentence at 16 kHz is small enough that the extra base64    */
/*  costs nothing worth measuring.                                     */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useRef, useState } from 'react';

/* ---------- Web Speech ---------- */

const SR = () => (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;

export function speechSupported() {
  return !!SR();
}

/* Web Speech is defined in more places than it works, and the gap is not
   something any feature check can see: Electron hands you a constructor, opens
   the microphone, and only then reports that it cannot reach the service.
   Presence is a promise; these errors are the lane breaking that promise.

   So the live lane is believed until it says otherwise, and never again for
   the rest of the session. Module scope on purpose — the assistant's mic and
   the brain dump's are two hooks against one browser, and the second should
   not have to rediscover what the first just learned. */
const LANE_IS_DEAD = new Set(['network', 'service-not-allowed', 'language-not-supported']);
let liveLaneDead = false;
export const liveLaneUsable = () => speechSupported() && !liveLaneDead;
export const markLiveLaneDead = () => { liveLaneDead = true; };
export const resetLiveLane = () => { liveLaneDead = false; }; // tests only

/* BCP-47 for the app's two languages. Egyptian Arabic rather than Modern
   Standard: the person dictating a task says "أروح الدكتور", not a news
   bulletin, and ar-EG is what Google actually trained on that. */
export const speechLocale = (lang) => (lang === 'ar' ? 'ar-EG' : 'en-US');

/* One live recognition session. Returns a handle with stop()/abort().
   `onText` receives the best transcript so far — final text plus whatever
   interim words are still being revised — so a caller can show the sentence
   forming and never has to stitch anything together itself. */
export function listen({ lang = 'en', onText, onDone, onError } = {}) {
  const Ctor = SR();
  if (!Ctor) { onError?.(new Error('unsupported')); return null; }
  const rec = new Ctor();
  rec.lang = speechLocale(lang);
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let settled = '';   // everything the engine has marked final
  let stopped = false;

  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) settled += (settled ? ' ' : '') + String(r[0].transcript).trim();
      else interim += r[0].transcript;
    }
    onText?.((settled + (interim ? ` ${interim}` : '')).trim(), !interim);
  };
  rec.onerror = (ev) => {
    // "no-speech" and "aborted" are how a normal short press ends, not faults.
    if (ev.error === 'no-speech' || ev.error === 'aborted') return;
    onError?.(new Error(ev.error || 'speech-error'));
  };
  rec.onend = () => { if (!stopped) { stopped = true; onDone?.(settled.trim()); } };

  try { rec.start(); } catch (e) { onError?.(e); return null; }

  return {
    stop() { stopped = true; try { rec.stop(); } catch { /* already ended */ } onDone?.(settled.trim()); },
    abort() { stopped = true; try { rec.abort(); } catch { /* already ended */ } },
  };
}

/* ---------- Recording ---------- */

export const recordingSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  && typeof window !== 'undefined' && !!window.MediaRecorder;

export const MAX_CLIP_MS = 60000; // a dictated instruction, not a voice memo

/* Start recording. Resolves once the microphone is actually live, so the UI
   only says "listening" when it is. The handle's stop() resolves with the
   recorded Blob; cancel() throws the clip away and releases the mic. */
export async function record({ onLevel, onCap } = {}) {
  if (!recordingSupported()) throw new Error('unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });

  let mime = '';
  for (const c of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (window.MediaRecorder.isTypeSupported?.(c)) { mime = c; break; }
  }
  const rec = new window.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  // A crude level meter, only so the button can show that the mic is hearing
  // something. Skipped entirely when nobody asked for it.
  let meter = null;
  if (onLevel) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      meter = { ac, raf: 0 };
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        onLevel(Math.min(1, peak / 90));
        meter.raf = requestAnimationFrame(tick);
      };
      meter.raf = requestAnimationFrame(tick);
    } catch { meter = null; }
  }

  const release = () => {
    if (meter) { cancelAnimationFrame(meter.raf); meter.ac.close().catch(() => {}); }
    stream.getTracks().forEach((t) => t.stop());
  };

  const done = new Promise((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
  });
  rec.start();
  // The cap has to tell somebody. Stopping the recorder silently leaves a
  // button that still says "listening" over a microphone that stopped a
  // minute ago; onCap is how the caller finishes the job it started.
  const cap = setTimeout(() => { onCap?.(); }, MAX_CLIP_MS);

  return {
    mimeType: rec.mimeType || mime || 'audio/webm',
    async stop() {
      clearTimeout(cap);
      if (rec.state !== 'inactive') rec.stop();
      const blob = await done;
      release();
      return blob;
    },
    cancel() {
      clearTimeout(cap);
      try { if (rec.state !== 'inactive') rec.stop(); } catch { /* already stopped */ }
      release();
    },
  };
}

/* ---------- Whatever came out of MediaRecorder -> 16 kHz mono WAV ---------- */

const TARGET_RATE = 16000;

export async function toWav(blob) {
  const bytes = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let decoded;
  try { decoded = await ac.decodeAudioData(bytes.slice(0)); } finally { ac.close().catch(() => {}); }

  // Downmix and resample in one pass. OfflineAudioContext does the resampling
  // properly; hand-rolled nearest-sample decimation aliases badly enough to
  // cost words.
  const frames = Math.max(1, Math.round(decoded.duration * TARGET_RATE));
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Off(1, frames, TARGET_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const mono = (await off.startRendering()).getChannelData(0);

  return encodeWav(mono, TARGET_RATE);
}

/* 16-bit PCM WAV. Written out by hand because there is nothing to install and
   the header is 44 fixed bytes. */
export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);        // PCM chunk size
  v.setUint16(20, 1, true);         // format: PCM
  v.setUint16(22, 1, true);         // channels: mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);  // byte rate
  v.setUint16(32, 2, true);         // block align
  v.setUint16(34, 16, true);        // bits per sample
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('read failed'));
    fr.onload = () => { const s = String(fr.result); resolve(s.slice(s.indexOf(',') + 1)); };
    fr.readAsDataURL(blob);
  });
}

/* ---------- Transcription ---------- */

const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta';
const STT_MODEL = 'gemini-flash-latest';

const sttPrompt = (lang) => `Transcribe this audio exactly as spoken. The speaker is using Egyptian Arabic, English, or a mix of both${lang === 'ar' ? ', most likely Arabic' : ''}. Write Arabic in Arabic script and English in Latin script, keeping any code-switching as it was said. Reply with ONLY the transcript — no quotes, no translation, no commentary, no description of the audio. If there is no intelligible speech, reply with an empty string.`;

/* Audio has no OpenAI-shaped equivalent worth using here, so this goes at
   Google's own API. The broker proxies that byte for byte at /gemini/<path>
   with a pool key swapped in, so the only difference between the two lanes is
   the base URL and which header carries the credential. */
export async function transcribe({ blob, lang = 'en', apiKey, broker, signal } = {}) {
  if (!blob || !blob.size) return '';
  const wav = await toWav(blob);
  const body = {
    contents: [{
      parts: [
        { text: sttPrompt(lang) },
        { inline_data: { mime_type: 'audio/wav', data: await blobToBase64(wav) } },
      ],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
  };

  const read = async (res) => {
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || '').join('').trim();
  };

  if (broker?.url && broker?.token) {
    let res = null;
    try {
      res = await fetch(`${broker.url}/gemini/v1beta/models/${STT_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': broker.token },
        body: JSON.stringify(body),
        signal,
      });
    } catch { res = null; } // unreachable — this device's own key is the fallback
    if (res && res.ok) return read(res);
    // The broker names its own failures; anything it relayed is a real answer,
    // and asking a local key would only get the same refusal again.
    if (res && res.headers.get('x-broker-provider')) throw new Error(`HTTP ${res.status}`);
    if (!apiKey) throw new Error(res ? `HTTP ${res.status}` : 'pool unavailable');
  }

  if (!apiKey) throw new Error('no API key');
  const res = await fetch(`${GEMINI_NATIVE}/models/${STT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 429) { const e = new Error('rate'); e.code = 'rate'; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return read(res);
}

/* ---------- The one thing a component actually wants ---------- */

/* A mic button's whole life: idle -> listening -> (transcribing) -> idle.
 *
 * `onText` is called with the running transcript while Web Speech is live, and
 * once with the final text on the recorded path — so a caller writes the same
 * two lines either way and never has to know which lane it got.
 *
 * `mode` is reported ('live' | 'clip' | null) purely so the UI can be honest:
 * on the recorded lane there is a pause at the end while the model listens,
 * and a button that pretends otherwise reads as broken. */
export function useDictation({ lang = 'en', apiKey, broker, onText, onError } = {}) {
  const [state, setState] = useState('idle'); // idle | listening | transcribing
  const [level, setLevel] = useState(0);
  const liveRef = useRef(null);
  const clipRef = useRef(null);
  // stop() is defined below start(), and the recording cap fires from inside
  // start()'s call — a ref is what lets the one reach the other.
  const stopRef = useRef(null);
  const cbRef = useRef({ onText, onError });
  cbRef.current = { onText, onError };

  const available = liveLaneUsable() || recordingSupported();
  const mode = liveLaneUsable() ? 'live' : recordingSupported() ? 'clip' : null;

  const finish = useCallback(() => { liveRef.current = null; clipRef.current = null; setLevel(0); setState('idle'); }, []);

  const stop = useCallback(async () => {
    if (liveRef.current) { const h = liveRef.current; liveRef.current = null; h.stop(); setState('idle'); return; }
    const clip = clipRef.current;
    if (!clip) return;
    clipRef.current = null;
    setState('transcribing');
    setLevel(0);
    try {
      const blob = await clip.stop();
      const text = await transcribe({ blob, lang, apiKey, broker });
      if (text) cbRef.current.onText?.(text, true);
      else cbRef.current.onError?.(new Error('no-speech'));
    } catch (e) {
      cbRef.current.onError?.(e);
    }
    finish();
  }, [lang, apiKey, broker, finish]);

  /* The recorded lane, on its own, so the live lane can hand over to it
     without the person having pressed anything twice. */
  const startClip = useCallback(async () => {
    if (!recordingSupported()) { setState('idle'); cbRef.current.onError?.(new Error('unsupported')); return; }
    try {
      const clip = await record({ onLevel: setLevel, onCap: () => stopRef.current?.() });
      clipRef.current = clip;
      setState('listening');
    } catch (e) {
      // getUserMedia rejects with NotAllowedError when the person says no, and
      // that is a decision, not a fault worth an error banner.
      cbRef.current.onError?.(e?.name === 'NotAllowedError' ? new Error('denied') : e);
      setState('idle');
    }
  }, []);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    if (liveLaneUsable()) {
      setState('listening');
      const h = listen({
        lang,
        onText: (t, final) => cbRef.current.onText?.(t, final),
        onDone: () => { liveRef.current = null; setState('idle'); },
        onError: (e) => {
          liveRef.current = null;
          /* The lane broke its promise. Retire it and start recording in the
             same press rather than reporting a failure the person can do
             nothing about — they asked to dictate, and there is a second way
             to do that. The first press loses the second or two before the
             error arrives; every press after this one goes straight to the
             recorder. */
          if (LANE_IS_DEAD.has(String(e?.message || e))) {
            markLiveLaneDead();
            startClip();
            return;
          }
          setState('idle');
          cbRef.current.onError?.(e);
        },
      });
      if (h) liveRef.current = h; else setState('idle');
      return;
    }
    setState('listening');
    await startClip();
  }, [state, lang, startClip]);

  stopRef.current = stop;

  const toggle = useCallback(() => { if (state === 'idle') start(); else if (state === 'listening') stop(); }, [state, start, stop]);

  const cancel = useCallback(() => {
    if (liveRef.current) { liveRef.current.abort(); liveRef.current = null; }
    if (clipRef.current) { clipRef.current.cancel(); clipRef.current = null; }
    finish();
  }, [finish]);

  // A dictation left running when its panel closes would keep the mic hot.
  useEffect(() => () => {
    if (liveRef.current) liveRef.current.abort();
    if (clipRef.current) clipRef.current.cancel();
  }, []);

  return { state, level, mode, available, start, stop, toggle, cancel, busy: state !== 'idle' };
}

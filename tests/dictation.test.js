/* The WAV encoder is the part of dictation that can fail silently.

   Everything else announces itself: a refused microphone throws, an
   unreachable model throws, a bad transcript comes back as visibly wrong
   words. A malformed header does not — Gemini accepts the request, hears
   nothing, and answers with an empty transcript that looks exactly like
   "you didn't say anything". So the header gets read back byte for byte. */
import { describe, it, expect, afterEach } from 'vitest';
import { encodeWav, speechLocale, speechSupported, recordingSupported, liveLaneUsable, markLiveLaneDead, resetLiveLane, listen } from '../src/dictation.js';

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const ascii = (b, off, n) => String.fromCharCode(...b.slice(off, off + n));
const u32 = (b, off) => new DataView(b.buffer, b.byteOffset).getUint32(off, true);
const u16 = (b, off) => new DataView(b.buffer, b.byteOffset).getUint16(off, true);

describe('encodeWav', () => {
  it('writes a header Gemini will actually accept: 16-bit mono PCM', async () => {
    const samples = new Float32Array(1600); // 0.1s at 16 kHz
    const b = await bytesOf(encodeWav(samples, 16000));

    expect(ascii(b, 0, 4)).toBe('RIFF');
    expect(ascii(b, 8, 4)).toBe('WAVE');
    expect(ascii(b, 12, 4)).toBe('fmt ');
    expect(ascii(b, 36, 4)).toBe('data');
    expect(u32(b, 16)).toBe(16);        // PCM fmt chunk length
    expect(u16(b, 20)).toBe(1);         // format 1 = PCM, not float
    expect(u16(b, 22)).toBe(1);         // mono
    expect(u32(b, 24)).toBe(16000);     // sample rate
    expect(u32(b, 28)).toBe(32000);     // byte rate = rate * channels * 2
    expect(u16(b, 32)).toBe(2);         // block align
    expect(u16(b, 34)).toBe(16);        // bits per sample
  });

  it('declares lengths that match the bytes it actually wrote', async () => {
    const samples = new Float32Array(777);
    const b = await bytesOf(encodeWav(samples, 16000));
    expect(b.length).toBe(44 + 777 * 2);
    expect(u32(b, 4)).toBe(b.length - 8);   // RIFF size excludes its own 8 bytes
    expect(u32(b, 40)).toBe(777 * 2);       // data chunk size
  });

  it('round-trips audio instead of quietly emitting silence', async () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const b = await bytesOf(encodeWav(samples, 16000));
    const dv = new DataView(b.buffer, b.byteOffset);
    const back = Array.from({ length: samples.length }, (_, i) => dv.getInt16(44 + i * 2, true));
    expect(back[0]).toBe(0);
    expect(back[1]).toBeCloseTo(0x7fff * 0.5, -1);
    expect(back[2]).toBeCloseTo(-0x8000 * 0.5, -1);
    // Full scale must not wrap: +1 written as -32768 is a loud click, and a
    // clipped shout is exactly when it would happen.
    expect(back[3]).toBe(0x7fff);
    expect(back[4]).toBe(-0x8000);
    expect(back.every((v) => v >= -0x8000 && v <= 0x7fff)).toBe(true);
  });

  it('clamps samples that arrive out of range rather than wrapping them', async () => {
    const b = await bytesOf(encodeWav(Float32Array.from([3, -3]), 16000));
    const dv = new DataView(b.buffer, b.byteOffset);
    expect(dv.getInt16(44, true)).toBe(0x7fff);
    expect(dv.getInt16(46, true)).toBe(-0x8000);
  });
});

describe('capability checks', () => {
  it('report nothing available in a bare environment instead of throwing', () => {
    // This is what the Node test runner is, and it is also close enough to a
    // locked-down WebView: the mic button must simply not render.
    expect(speechSupported()).toBe(false);
    expect(recordingSupported()).toBe(false);
  });
});

describe('speechLocale', () => {
  it('asks for Egyptian Arabic, not Modern Standard', () => {
    expect(speechLocale('ar')).toBe('ar-EG');
    expect(speechLocale('en')).toBe('en-US');
    expect(speechLocale(undefined)).toBe('en-US');
  });
});

/* The Electron trap.

   Electron hands the page a webkitSpeechRecognition constructor and opens the
   microphone with it, then reports error:network — the open-source Chromium it
   is built from has no credentials for Google's speech service. Measured on
   the real window by desktop/mic-probe.mjs:

       start -> audiostart -> error:network -> end

   A feature check cannot see any of that, so the live lane is believed until
   it breaks its promise and retired for the session when it does. Without
   this, the desktop app renders a mic button that can only ever fail. */
describe('retiring a live lane that does not work', () => {
  const install = (behaviour) => {
    class FakeRecognition {
      start() { setTimeout(() => behaviour(this), 0); }
      stop() {}
      abort() {}
    }
    globalThis.window = { SpeechRecognition: FakeRecognition };
    return FakeRecognition;
  };
  afterEach(() => { delete globalThis.window; resetLiveLane(); });

  it('counts a defined-but-broken engine as unusable once it has said so', () => {
    install(() => {});
    expect(speechSupported()).toBe(true);
    expect(liveLaneUsable()).toBe(true);
    markLiveLaneDead();
    // Still "supported" — the constructor never went anywhere. Just not usable.
    expect(speechSupported()).toBe(true);
    expect(liveLaneUsable()).toBe(false);
  });

  it('is shared, so the second microphone does not relearn it', () => {
    install(() => {});
    markLiveLaneDead();
    expect(liveLaneUsable()).toBe(false); // module scope, not per-hook
  });

  it('surfaces the error code the hook decides on', async () => {
    install((r) => r.onerror({ error: 'network' }));
    const code = await new Promise((resolve) => {
      listen({ lang: 'en', onError: (e) => resolve(e.message) });
    });
    expect(code).toBe('network');
  });

  it('does not report the ends of a normal short press as faults', async () => {
    // 'no-speech' and 'aborted' are what a quick tap looks like from the
    // engine's side; treating either as an error would put a red banner under
    // every mistap.
    for (const err of ['no-speech', 'aborted']) {
      install((r) => { r.onerror({ error: err }); r.onend(); });
      const outcome = await new Promise((resolve) => {
        listen({ lang: 'en', onError: () => resolve('error'), onDone: () => resolve('done') });
      });
      expect(outcome, err).toBe('done');
    }
  });
});

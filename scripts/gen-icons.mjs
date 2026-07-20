/* Generates PWA icons (PNG) + favicon.svg for Rhythm.
   The mark matches the in-app AppIcon: verdigris rounded square,
   white sun disc, white horizon bar. Pure pngjs — no native deps. */
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });

const BG = [0x3e, 0x8a, 0x6c]; // verdigris
const FG = [0xf8, 0xfc, 0xf9]; // off-white

function makeIcon(size, { pad = 0, rounded = true } = {}) {
  const png = new PNG({ width: size, height: size });
  const s = size;
  const inset = Math.round(s * pad);          // maskable icons need safe-zone padding
  const box = s - inset * 2;                  // drawn square
  const r = rounded ? box * (9 / 32) : 0;     // corner radius matches the SVG mark (rx=9 of 32)
  // geometry in "box" space, scaled from the 32×32 SVG: sun cx=16 cy=13 r=6; bar x=6 y=22 w=20 h=2.6 rx=1.3
  const cx = inset + box * (16 / 32), cy = inset + box * (13 / 32), rad = box * (6 / 32);
  const bx0 = inset + box * (6 / 32), bx1 = inset + box * (26 / 32);
  const by0 = inset + box * (22 / 32), by1 = inset + box * (24.6 / 32);
  const bR = box * (1.3 / 32);

  const inRoundedBox = (x, y) => {
    const lx = x - inset, ly = y - inset;
    if (lx < 0 || ly < 0 || lx >= box || ly >= box) return false;
    const dx = Math.max(r - lx, lx - (box - r), 0);
    const dy = Math.max(r - ly, ly - (box - r), 0);
    return dx * dx + dy * dy <= r * r || dx === 0 || dy === 0;
  };
  const inSun = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  const inBar = (x, y) => {
    if (y < by0 || y > by1) return false;
    if (x >= bx0 + bR && x <= bx1 - bR) return true;
    const ex = x < bx0 + bR ? bx0 + bR : bx1 - bR;
    const ey = (by0 + by1) / 2, er = (by1 - by0) / 2;
    return ((x - ex) / bR) ** 2 + ((y - ey) / er) ** 2 <= 1;
  };

  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (s * y + x) << 2;
    // maskable variant fills the whole square with BG (no transparency), others keep rounded alpha
    const inside = pad > 0 ? true : inRoundedBox(x + 0.5, y + 0.5);
    const fg = inSun(x + 0.5, y + 0.5) || inBar(x + 0.5, y + 0.5);
    const c = fg ? FG : BG;
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2];
    png.data[i + 3] = inside ? 255 : 0;
  }
  return PNG.sync.write(png);
}

writeFileSync('public/pwa-192.png', makeIcon(192));
writeFileSync('public/pwa-512.png', makeIcon(512));
writeFileSync('public/pwa-maskable-512.png', makeIcon(512, { pad: 0.14, rounded: false }));
writeFileSync('public/apple-touch-icon.png', makeIcon(180, { pad: 0, rounded: false }));
writeFileSync('public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#3E8A6C"/><circle cx="16" cy="13" r="6" fill="#F8FCF9"/><rect x="6" y="22" width="20" height="2.6" rx="1.3" fill="#F8FCF9"/></svg>`);
console.log('icons written to public/');

/* ---- Android launcher icons ----------------------------------------
   Without this the APK ships Capacitor's stock template icon, which is why
   the home screen doesn't match the app. Adaptive icons (API 26+) composite a
   foreground over a background layer and the system masks the result, so the
   foreground must be TRANSPARENT with the mark inside the safe zone: the outer
   ~1/6 of each edge can be cropped by the mask, so the mark is drawn at ~50%
   scale, centred. Legacy ic_launcher/_round keep the full rounded mark. */
const ANDROID_RES = 'android/app/src/main/res';
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

/* Transparent canvas with just the white sun+bar, scaled into the safe zone. */
function makeAdaptiveForeground(size) {
  const png = new PNG({ width: size, height: size });
  const box = size * 0.5;                 // mark occupies the middle half
  const off = (size - box) / 2;
  const cx = off + box * (16 / 32), cy = off + box * (13 / 32), rad = box * (6 / 32);
  const bx0 = off + box * (6 / 32), bx1 = off + box * (26 / 32);
  const by0 = off + box * (22 / 32), by1 = off + box * (24.6 / 32);
  const bR = box * (1.3 / 32);
  const inSun = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  const inBar = (x, y) => {
    if (y < by0 || y > by1) return false;
    if (x >= bx0 + bR && x <= bx1 - bR) return true;
    const ex = x < bx0 + bR ? bx0 + bR : bx1 - bR;
    const ey = (by0 + by1) / 2, er = (by1 - by0) / 2;
    return ((x - ex) / bR) ** 2 + ((y - ey) / er) ** 2 <= 1;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (size * y + x) << 2;
    const fg = inSun(x + 0.5, y + 0.5) || inBar(x + 0.5, y + 0.5);
    png.data[i] = FG[0]; png.data[i + 1] = FG[1]; png.data[i + 2] = FG[2];
    png.data[i + 3] = fg ? 255 : 0;
  }
  return PNG.sync.write(png);
}

try {
  for (const [density, px] of Object.entries(DENSITIES)) {
    const dir = `${ANDROID_RES}/mipmap-${density}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/ic_launcher.png`, makeIcon(px));
    writeFileSync(`${dir}/ic_launcher_round.png`, makeIcon(px));
    // adaptive foreground is drawn on a 108dp canvas => 1.5x the legacy size
    writeFileSync(`${dir}/ic_launcher_foreground.png`, makeAdaptiveForeground(Math.round(px * 1.5)));
  }
  // The adaptive background layer is a flat colour resource; make it verdigris.
  mkdirSync(`${ANDROID_RES}/values`, { recursive: true });
  writeFileSync(`${ANDROID_RES}/values/ic_launcher_background.xml`,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#3E8A6C</color>\n</resources>\n');
  console.log('android launcher icons written to', ANDROID_RES);
} catch (e) {
  console.log('skipped android icons (no android/ project):', e.message);
}

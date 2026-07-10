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

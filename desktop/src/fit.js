/* Keeping a window on a screen that still exists.

   Windows remember where they were. Put the overlay on an external monitor,
   unplug the monitor, and the saved position now points at empty space: the
   window is "visible", always on top, and nowhere anyone can see or drag it.
   Nothing in Windows brings a frameless, taskbar-less window back on its own.

   fitRect answers one question: where should this rectangle go so that it is
   fully inside some display's work area? If enough of it already sits on a
   display, it is only nudged inside that display's edges. If it is on none,
   it goes to `fallback` (the overlay's default corner on the primary screen).

   Pure, so it can be tested without Electron. */

const overlap = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const clampInto = (r, area) => ({
  x: Math.round(Math.min(Math.max(r.x, area.x), area.x + Math.max(0, area.width - r.width))),
  y: Math.round(Math.min(Math.max(r.y, area.y), area.y + Math.max(0, area.height - r.height))),
});

/* rect      { x, y, width, height } — where the window is now.
   areas     every display's work area.
   fallback  { x, y } to use when the window is on no display at all.
   minShare  how much of the window must be on a display to count as "there"
             (a sliver at the edge of a screen is not a reachable window). */
function fitRect(rect, areas, fallback, minShare = 0.25) {
  const size = rect.width * rect.height || 1;
  let best = null;
  let bestArea = 0;
  for (const a of areas || []) {
    const o = overlap(rect, a);
    if (o > bestArea) { bestArea = o; best = a; }
  }
  if (!best || bestArea / size < minShare) return { x: Math.round(fallback.x), y: Math.round(fallback.y) };
  return clampInto(rect, best);
}

module.exports = { fitRect };

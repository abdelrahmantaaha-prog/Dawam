/* The overlay must never be left on a screen that has been unplugged. */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { fitRect } = require_('../desktop/src/fit.js');

const laptop = { x: 0, y: 0, width: 1920, height: 1040 };
const external = { x: 1920, y: 0, width: 2560, height: 1400 };
const corner = { x: 1564, y: 16 };
const W = 340, H = 92;

describe('fitRect', () => {
  it('leaves a window that is fully on a screen where it is', () => {
    expect(fitRect({ x: 100, y: 200, width: W, height: H }, [laptop], corner)).toEqual({ x: 100, y: 200 });
    expect(fitRect({ x: 3000, y: 500, width: W, height: H }, [laptop, external], corner)).toEqual({ x: 3000, y: 500 });
  });

  it('brings the overlay home when the screen it was on is unplugged', () => {
    // It lived on the external monitor; now only the laptop is left.
    expect(fitRect({ x: 3000, y: 500, width: W, height: H }, [laptop], corner)).toEqual(corner);
  });

  it('pulls a window hanging off an edge back inside that screen', () => {
    expect(fitRect({ x: 1800, y: -20, width: W, height: H }, [laptop], corner)).toEqual({ x: 1920 - W, y: 0 });
  });

  it('treats a sliver at the edge as lost, not as reachable', () => {
    expect(fitRect({ x: 1910, y: 100, width: W, height: H }, [laptop], corner)).toEqual(corner);
  });

  it('falls back when there are no displays reported at all', () => {
    expect(fitRect({ x: 10, y: 10, width: W, height: H }, [], corner)).toEqual(corner);
  });
});

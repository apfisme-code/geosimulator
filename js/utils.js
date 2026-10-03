// Pure utility helpers — no module-level state.

import { GRID } from './constants.js';
const { L, N, cellSize, TAU } = GRID;

// Perlin's quintic fade curve (used by the 4D noise sampler)
export const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

// Toroidal bilinear lookup: field is N*N flat array, sx/sz are in cell units.
// We pre-clamp to one torus span [0, N) so callers passing arbitrarily
// large velocity (or anything > 2^32 from cumulative drift) don't hit
// floating-point precision loss in the % N step.
export function bilinearWrap(field, sx, sz) {
  sx = sx - Math.floor(sx / N) * N;
  sz = sz - Math.floor(sz / N) * N;
  if (sx < 0) sx += N;
  if (sz < 0) sz += N;
  const i0 = sx | 0;
  const j0 = sz | 0;
  const i1 = i0 === N - 1 ? 0 : i0 + 1;
  const j1 = j0 === N - 1 ? 0 : j0 + 1;
  const tx = sx - i0, tz = sz - j0;
  const a = field[j0 * N + i0];
  const b = field[j0 * N + i1];
  const c = field[j1 * N + i0];
  const d = field[j1 * N + i1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// Re-export commonly used geometric values so consumers can `import {…} from './utils.js'`
export { L, N, cellSize, TAU };

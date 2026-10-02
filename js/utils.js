// Pure utility helpers — no module-level state.

import { GRID } from './constants.js';
const { L, N, cellSize, TAU } = GRID;

// Perlin's quintic fade curve (used by the 4D noise sampler)
export const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

// Toroidal bilinear lookup: field is N*N flat array, sx/sz are in cell units.
export function bilinearWrap(field, sx, sz) {
  sx = ((sx % N) + N) % N;
  sz = ((sz % N) + N) % N;
  const i0 = Math.floor(sx), j0 = Math.floor(sz);
  const i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
  const tx = sx - i0, tz = sz - j0;
  const a = field[j0 * N + i0];
  const b = field[j0 * N + i1];
  const c = field[j1 * N + i0];
  const d = field[j1 * N + i1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// Re-export commonly used geometric values so consumers can `import {…} from './utils.js'`
export { L, N, cellSize, TAU };

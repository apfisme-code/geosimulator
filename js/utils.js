// Pure utility helpers — no module-level state.

import { GRID } from './constants.js';
const { L, N, cellSize, TAU } = GRID;

/**
 * Perlin's quintic fade curve. Maps `t` ∈ [0, 1] smoothly to itself with
 * zero first- and second-order derivatives at both ends. Used by the
 * 4D noise sampler to interpolate between lattice corners.
 * @param {number} t  Input in [0, 1].
 * @returns {number}  Smoothed value in [0, 1].
 */
export const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Toroidal bilinear lookup. `field` is a flat `N*N` array; `sx`/`sz` are
 * sample positions in cell units (can be any real number, including values
 * outside [0, N) that result from cumulative drift).
 *
 * We pre-clamp to one torus span `[0, N)` using `x - floor(x/N)*N` rather
 * than `x % N` so callers passing arbitrarily large velocities (or values
 * > 2³² from long cumulative drift) don't hit floating-point precision
 * loss in the modulo step.
 *
 * @template T
 * @param {Float32Array|TypedArray} field  Flat N*N sample array.
 * @param {number} sx  Sample position X in cell units.
 * @param {number} sz  Sample position Z in cell units.
 * @returns {number}   Bilinearly interpolated value at (sx, sz).
 */
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

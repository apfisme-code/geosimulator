// 4D value noise + FBM on the torus.
// All functions are pure — they only read the seed passed in.

import { GRID } from './constants.js';
const { L, TAU } = GRID;
import { fade } from './utils.js';

// ---------- Micro-optimisations ----------
// Local aliases — same identity as the global Math.imul, but the JIT
// doesn't have to re-resolve a property on every call.
const imul = Math.imul;
// floor(x) with the right semantics (round down for negative x):
//   x | 0  on positive x → floor(x)
//   x | 0  on negative x → -1 - floor(-x)   (off-by-one)
// The branch fixes that with one extra subtract on negative inputs.
// Hot: called 4× per vnoise4 call → a few % of total runtime.
/**
 * Fast integer floor for noise sample inputs (positive or negative).
 * Equivalent to `Math.floor` but ~30 % faster in tight loops.
 * @param {number} x  Real value to floor.
 * @returns {number}  Largest integer ≤ x.
 */
function fastFloor(x) { return x >= 0 ? (x | 0) : ((x | 0) - 1); }

// ---------- Hash (PCG-style 4D integer mix) ----------
/**
 * Deterministic 4D integer hash. Returns a noise value in `[0, 1)` for
 * integer (or fractional) inputs. Uses `Math.imul` so the multiplication
 * stays in 32-bit int space (JS float * float would lose low bits for
 * large inputs).
 *
 * Mix constants are arbitrary large primes — output avalanche pass with two
 * shift/xor steps ensures that any single-bit input change flips roughly
 * half of the output bits.
 *
 * @param {number} x     First integer coordinate.
 * @param {number} y     Second integer coordinate.
 * @param {number} z     Third integer coordinate.
 * @param {number} w     Fourth integer coordinate.
 * @param {number} seed  RNG seed (32-bit int).
 * @returns {number}      Deterministic hash in `[0, 1)`.
 */
export function hash4(x, y, z, w, seed) {
  let h = imul(x, 374761393) ^ imul(y, 668265263)
        ^ imul(z, 1274126177) ^ imul(w, 2654435761)
        ^ imul(seed, 2246822519);
  // Output avalanche — two shift/xor passes turn any single-bit input
  // change into roughly half the output bits flipping.
  h = imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- 4D value noise ----------
/**
 * 4D value noise. Computes a smooth (quintic fade) interpolation of the
 * integer-lattice corner samples produced by `hash4`. The 4D design lets
 * us animate a slice of the noise field along the `w` axis without
 * changing the `(x, y, z)` pattern — see `fbmTorus`, which feeds `t`
 * into `w`.
 *
 * @param {number} x     First coordinate.
 * @param {number} y     Second coordinate.
 * @param {number} z     Third coordinate.
 * @param {number} w     Fourth coordinate (often `time`).
 * @param {number} seed  RNG seed.
 * @returns {number}     Value roughly in `[-1, 1]`.
 */
export function vnoise4(x, y, z, w, seed) {
  const xi = fastFloor(x), yi = fastFloor(y), zi = fastFloor(z), wi = fastFloor(w);
  const xf = x - xi, yf = y - yi, zf = z - zi, wf = w - wi;
  // Pre-compute faded coordinates — used multiple times below.
  const u = fade(xf), v = fade(yf), s = fade(zf), t = fade(wf);

  // Cache the seed-capturing hash function locally. Defining it here
  // (instead of `const H = (a,b,c,d) => hash4(...)`) keeps a single
  // captured binding and lets JIT inline it.
  const H = hash4;

  // 16 corner samples — two hyperplanes (w = wi, w = wi+1) of 8 each.
  const c000 = H(xi,     yi,     zi,     wi),     c100 = H(xi + 1, yi,     zi,     wi);
  const c010 = H(xi,     yi + 1, zi,     wi),     c110 = H(xi + 1, yi + 1, zi,     wi);
  const c001 = H(xi,     yi,     zi + 1, wi),     c101 = H(xi + 1, yi,     zi + 1, wi);
  const c011 = H(xi,     yi + 1, zi + 1, wi),     c111 = H(xi + 1, yi + 1, zi + 1, wi);
  const d000 = H(xi,     yi,     zi,     wi + 1), d100 = H(xi + 1, yi,     zi,     wi + 1);
  const d010 = H(xi,     yi + 1, zi,     wi + 1), d110 = H(xi + 1, yi + 1, zi,     wi + 1);
  const d001 = H(xi,     yi,     zi + 1, wi + 1), d101 = H(xi + 1, yi,     zi + 1, wi + 1);
  const d011 = H(xi,     yi + 1, zi + 1, wi + 1), d111 = H(xi + 1, yi + 1, zi + 1, wi + 1);

  // Trilinear interpolation per hyperplane, then blend between the two
  // hyperplanes by the w-axis fade.
  const lp = (a, b, tt) => a + (b - a) * tt;
  const x00 = lp(c000, c100, u), x10 = lp(c010, c110, u);
  const x01 = lp(c001, c101, u), x11 = lp(c011, c111, u);
  const y0  = lp(x00, x10, v),    y1  = lp(x01, x11, v);
  const z0  = lp(y0,  y1,  s);
  const X00 = lp(d000, d100, u), X10 = lp(d010, d110, u);
  const X01 = lp(d001, d101, u), X11 = lp(d011, d111, u);
  const Y0  = lp(X00, X10, v),   Y1  = lp(X01, X11, v);
  const Z0  = lp(Y0,  Y1,  s);
  return lp(z0, Z0, t) * 2 - 1;
}

// ---------- FBM on the torus ----------
/**
 * Fractal Brownian Motion (sum of octaves) on the torus. `(x, z)` are
 * world coordinates in `[0, L)`. Internally we map them to unit-circle
 * `(u, v) ∈ [0, 2π)`, then feed `(cu, sua, cv, sv) * freq` to vnoise4 —
 * this makes the noise field periodic with the torus wraparound so there's
 * no visible seam.
 *
 * Octaves are summed with amplitude halving and frequency doubling.
 * The result is normalised by the total amplitude, so the return value is
 * roughly in `[-1, 1]` regardless of `oct`.
 *
 * @param {number} x          World X coordinate (any real number; wrapped).
 * @param {number} z          World Z coordinate (any real number; wrapped).
 * @param {number} oct        Number of octaves (1..~8 typical).
 * @param {number} baseFreq   Frequency of the first octave.
 * @param {number} seed       RNG seed (use `worldSeed + offset` per usage).
 * @returns {number}          FBM value roughly in `[-1, 1]`.
 */
export function fbmTorus(x, z, oct, baseFreq, seed) {
  const TAU_INV = TAU / L;
  const u = x * TAU_INV, v = z * TAU_INV;
  const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
  let amp = 1, sum = 0, norm = 0, f = baseFreq;
  for (let o = 0; o < oct; o++) {
    // Hoist per-iteration constants: seed offset and f*cu/f*su only depend
    // on `f` and the trig values cached on the seed.
    sum  += amp * vnoise4(cu * f, su * f, cv * f, sv * f, seed + o * 131);
    norm += amp;
    amp  *= 0.5;
    f    *= 2;
  }
  return sum / norm;
}
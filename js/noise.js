// 4D value noise + FBM on the torus.
// All functions are pure — they only read the seed passed in.

import { L, TAU } from './constants.js';
import { fade } from './utils.js';

export function hash4(x, y, z, w, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
        ^ Math.imul(z, 1274126177) ^ Math.imul(w, 2654435761)
        ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise4(x, y, z, w, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), wi = Math.floor(w);
  const xf = x - xi, yf = y - yi, zf = z - zi, wf = w - wi;
  const u = fade(xf), v = fade(yf), s = fade(zf), t = fade(wf);
  const H = (a, b, c, d) => hash4(a, b, c, d, seed);
  const lp = (a, b, tt) => a + (b - a) * tt;
  const c000 = H(xi,     yi,     zi,     wi),     c100 = H(xi + 1, yi,     zi,     wi);
  const c010 = H(xi,     yi + 1, zi,     wi),     c110 = H(xi + 1, yi + 1, zi,     wi);
  const c001 = H(xi,     yi,     zi + 1, wi),     c101 = H(xi + 1, yi,     zi + 1, wi);
  const c011 = H(xi,     yi + 1, zi + 1, wi),     c111 = H(xi + 1, yi + 1, zi + 1, wi);
  const d000 = H(xi,     yi,     zi,     wi + 1), d100 = H(xi + 1, yi,     zi,     wi + 1);
  const d010 = H(xi,     yi + 1, zi,     wi + 1), d110 = H(xi + 1, yi + 1, zi,     wi + 1);
  const d001 = H(xi,     yi,     zi + 1, wi + 1), d101 = H(xi + 1, yi,     zi + 1, wi + 1);
  const d011 = H(xi,     yi + 1, zi + 1, wi + 1), d111 = H(xi + 1, yi + 1, zi + 1, wi + 1);
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

// FBM on the torus: sample the unit-circle coordinates of (x,z) wrapped to L.
export function fbmTorus(x, z, oct, baseFreq, seed) {
  const u = (x / L) * TAU, v = (z / L) * TAU;
  const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
  let amp = 1, sum = 0, norm = 0, f = baseFreq;
  for (let o = 0; o < oct; o++) {
    sum  += amp * vnoise4(cu * f, su * f, cv * f, sv * f, seed + o * 131);
    norm += amp;
    amp  *= 0.5;
    f    *= 2;
  }
  return sum / norm;
}

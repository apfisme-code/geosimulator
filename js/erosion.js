// Erosion: talus sliding, diffusion, transport-limited river erosion,
// evaporation, lake filling/draining. Pure mutation of the height stack.

import {
  N, cellSize,
  TALUS, SLIDE_K, DIFF_K,
  K_CAP, K_ERODE, K_ERODE_ROCK, K_DEPOSIT, MAX_ERODE,
  EVAP, LAKE_FILL_RATE, LAKE_DRAIN_RATE,
  K_RIVER_ERODE, K_DRAIN_ROUTING,
} from './constants.js';
import { smoothstep } from './constants.js';
import { State, Globals } from './state.js';

const H1 = State.H1, H2 = State.H2, H3 = State.H3, H4 = State.H4;
const H1t = State.H1t, H2t = State.H2t, H3t = State.H3t, H4t = State.H4t;

// Move sediment between a pair of cells until both sit within TALUS[i] of each other,
// layer-by-layer from soft soil down to hard rock. Also diffuse H1 between neighbours.
export function talusPair(a, b, dt) {
  const hA = H1t[a] + H2t[a] + H3t[a] + H4t[a];
  const hB = H1t[b] + H2t[b] + H3t[b] + H4t[b];
  const d = hA - hB, ad = Math.abs(d);
  if (ad < TALUS[0]) return;
  const src = d > 0 ? a : b;
  const dst = d > 0 ? b : a;

  let m;
  m = SLIDE_K * Math.max(0, ad - TALUS[0]) * dt;
  if (m > 0) { const amt = Math.min(Math.max(0, H1t[src]), m); if (amt > 0) { H1t[src] -= amt; H1t[dst] += amt; } }
  m = SLIDE_K * Math.max(0, ad - TALUS[1]) * dt;
  if (m > 0) { const amt = Math.min(Math.max(0, H2t[src]), m); if (amt > 0) { H2t[src] -= amt; H2t[dst] += amt; } }
  m = SLIDE_K * Math.max(0, ad - TALUS[2]) * dt;
  if (m > 0) { const amt = Math.min(Math.max(0, H3t[src]), m); if (amt > 0) { H3t[src] -= amt; H3t[dst] += amt; } }
  m = SLIDE_K * Math.max(0, ad - TALUS[3]) * dt;
  if (m > 0) { const amt = Math.min(Math.max(0, H4t[src]), m); if (amt > 0) { H4t[src] -= amt; H4t[dst] += amt; } }

  // Diffuse the soft top layer only — keeps ridges sharper on stone.
  const dSoft = H1t[a] - H1t[b];
  const diffAmt = DIFF_K * dSoft * dt;
  if (diffAmt > 0) {
    const amt = Math.min(Math.max(0, H1t[a]), diffAmt);
    H1t[a] -= amt; H1t[b] += amt;
  } else if (diffAmt < 0) {
    const amt = Math.min(Math.max(0, H1t[b]), -diffAmt);
    H1t[b] -= amt; H1t[a] += amt;
  }
}

// Sweep talusPair over the 4-neighbour grid, copy results back.
export function applyTalus(dt) {
  H1t.set(H1); H2t.set(H2); H3t.set(H3); H4t.set(H4);
  for (let j = 0; j < N; j++) {
    const jS = (j + 1) % N;
    const rowC = j * N, rowN = jS * N;
    for (let i = 0; i < N; i++) {
      const iE = (i + 1) % N, a = rowC + i;
      talusPair(a, rowC + iE, dt);
      talusPair(a, rowN + i,  dt);
    }
  }
  H1.set(H1t); H2.set(H2t); H3.set(H3t); H4.set(H4t);
}

// Transport-limited erosion/deposition driven by water flux and slope.
export function riverErosion(dt) {
  for (let k = 0; k < N * N; k++) {
    const i = k % N, j = (k / N) | 0;
    const iE = (i + 1) % N, iW = (i - 1 + N) % N;
    const jN = (j + 1) % N, jS = (j - 1 + N) % N;
    const g = kk => H1[kk] + H2[kk] + H3[kk] + H4[kk];
    const dhdx = (g(j * N + iE) - g(j * N + iW)) / (2 * cellSize);
    const dhdz = (g(jN * N + i) - g(jS * N + i)) / (2 * cellSize);
    const slope = Math.hypot(dhdx, dhdz);
    const slopeFactor = smoothstep(0.02, 0.35, slope);
    const upstreamTerm = Math.sqrt(State.flowAccumRouting[k]) * K_DRAIN_ROUTING;
    const cap = K_CAP * (State.Fmag[k] + upstreamTerm) * (0.10 + 0.90 * slopeFactor);
    const s = State.Sed[k];
    if (cap > s) {
      const riverErode = K_RIVER_ERODE *
        Math.min(1, Math.log(1 + State.flowAccumRouting[k]) / Math.log(1 + 300)) * dt;
      let amount = (cap - s) * K_ERODE * (0.3 + 0.7 * slopeFactor) * dt + riverErode;
      if (amount > MAX_ERODE) amount = MAX_ERODE;
      if (amount > 0) {
        let rem = amount;
        const e1 = Math.min(H1[k], rem); H1[k] -= e1; rem -= e1;
        const e2 = Math.min(H2[k], rem); H2[k] -= e2; rem -= e2;
        const e3 = Math.min(H3[k], rem); H3[k] -= e3; rem -= e3;
        const e4 = rem * K_ERODE_ROCK;
        H4[k] -= e4;
        State.Sed[k] += e1 + e2 + e3 + e4;
      }
    } else if (s > cap) {
      let dep = (s - cap) * K_DEPOSIT * (0.5 + 2.0 * (1 - slopeFactor)) * dt;
      if (dep > s) dep = s;
      if (dep > 0) { H1[k] += dep; State.Sed[k] -= dep; }
    }
  }
}

// Evaporation drains shallow water; tiny residues get snapped to zero.
export function evaporate(dt) {
  const ev = Math.max(0, 1 - EVAP * dt);
  for (let k = 0; k < N * N; k++) {
    State.W[k] *= ev;
    if (State.W[k] < 1e-5) { State.W[k] = 0; State.Sed[k] = 0; }
  }
}

// Ocean cells are clamped to sea level; lakes fill/drain toward spill level.
export function applyLakes(dt) {
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    if (surface < Globals.seaLevel) {
      State.W[k] = Globals.seaLevel - surface;
    } else {
      const lakeTarget = Math.max(0, State.spillLevel[k] - surface);
      if (lakeTarget > 0.1) {
        if (State.W[k] < lakeTarget) {
          State.W[k] = Math.min(lakeTarget, State.W[k] + LAKE_FILL_RATE * dt);
        } else if (State.W[k] > lakeTarget + 0.05) {
          State.W[k] = Math.max(lakeTarget, State.W[k] - LAKE_DRAIN_RATE * dt);
        }
      }
    }
  }
}

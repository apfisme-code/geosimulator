// Surface processes: lithification (H1→H2→H3→H4) and weathering (reverse),
// plus the soil/gravel/soft-rock initialisers.

import {
  N, L, cellSize, AQ_MAX,
  ICE_FREEBORD_RATIO,
} from './constants.js';
import { State, Globals, H1, H2, H3, H4 } from './state.js';
import { fbmTorus } from './noise.js';

// Soil: thinner underwater, modulated by FBM noise.
export function initSoil(idx) {
  const t = State.targetSurface[idx];
  if (t < Globals.seaLevel - 8) return 0.05;
  const n = fbmTorus((idx % N) * cellSize, ((idx / N) | 0) * cellSize, 3, 6.0, Globals.worldSeed + 11);
  return Math.max(0.05, 0.5 + 0.4 * n);
}
export function initGravel(idx) {
  const t = State.targetSurface[idx];
  if (t < Globals.seaLevel - 15) return 0.1;
  const n = fbmTorus((idx % N) * cellSize, ((idx / N) | 0) * cellSize, 3, 5.0, Globals.worldSeed + 22);
  return Math.max(0.1, 1.5 + 0.7 * n);
}
export function initSoftRock(idx) {
  const t = State.targetSurface[idx];
  if (t < Globals.seaLevel - 10) return 0.2;
  const n = fbmTorus((idx % N) * cellSize, ((idx / N) | 0) * cellSize, 3, 4.0, Globals.worldSeed + 33);
  return Math.max(0.2, 3.5 + 1.5 * n);
}

// Lithify on the surface; weather back down when wet soil sits on stone.
// Underwater lithification is much faster (sediment compaction).
export function lithify(dt) {
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    const isUnderwater = surface < Globals.seaLevel;
    const lithH1 = isUnderwater ? 0.008 : 0.0003;
    const lithH2 = isUnderwater ? 0.004 : 0.0003;
    const lithH3 = isUnderwater ? 0.001 : 0.0001;

    if (H1[k] > 0) {
      const amt = Math.min(H1[k], lithH1 * H1[k] * dt);
      H1[k] -= amt; H2[k] += amt;
    }
    if (H2[k] > 0) {
      const amt = Math.min(H2[k], lithH2 * H2[k] * dt);
      H2[k] -= amt; H3[k] += amt;
    }
    if (H3[k] > 0 && (H1[k] + H2[k]) > 2.0) {
      const amt = Math.min(H3[k], lithH3 * H3[k] * dt);
      H3[k] -= amt; H4[k] += amt;
    }
    if (!isUnderwater) {
      const moisture = 0.5 + 0.5 * Math.min(1, State.W[k] * 8);
      const exp2 = Math.exp(-H1[k] / 0.5);
      if (H2[k] > 0 && exp2 > 0.02) {
        const amt = Math.min(H2[k], 0.004 * exp2 * moisture * dt);
        H2[k] -= amt; H1[k] += amt;
      }
      const exp3 = Math.exp(-(H1[k] + H2[k]) / 0.8);
      if (H3[k] > 0 && exp3 > 0.02) {
        const amt = Math.min(H3[k], 0.002 * exp3 * moisture * dt);
        H3[k] -= amt; H2[k] += amt;
      }
      const exp4 = Math.exp(-(H1[k] + H2[k] + H3[k]) / 1.0);
      if (H4[k] > 0 && exp4 > 0.02) {
        const amt = Math.min(H4[k], 0.0005 * exp4 * moisture * dt);
        H4[k] -= amt; H3[k] += amt;
      }
    }
  }
}

// Sample the visible top of the column (used by player height query).
export function sampleHeight(x, z) {
  x = ((x % L) + L) % L;
  z = ((z % L) + L) % L;
  const fx = x / cellSize, fz = z / cellSize;
  const i0 = Math.floor(fx) % N, j0 = Math.floor(fz) % N;
  const i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
  const tx = fx - Math.floor(fx), tz = fz - Math.floor(fz);
  const top = k => {
    const s = H1[k] + H2[k] + H3[k] + H4[k];
    if (s > Globals.seaLevel) return s + State.snowLayer[k];
    if (State.iceLayer[k] > 0.05) {
      return Globals.seaLevel + ICE_FREEBORD_RATIO * State.iceLayer[k] + State.snowLayer[k];
    }
    return s;
  };
  return ((top(j0 * N + i0) * (1 - tx) + top(j0 * N + i1) * tx) * (1 - tz)
        + (top(j1 * N + i0) * (1 - tx) + top(j1 * N + i1) * tx) * tz);
}

// NaN/clamp safety net at the end of every simulation step.
export function clampSafety() {
  let violated = 0;
  for (let k = 0; k < N * N; k++) {
    if (H1[k] < 0)   { H1[k] = 0;   violated++; }
    if (H2[k] < 0)   { H2[k] = 0;   violated++; }
    if (H3[k] < 0)   { H3[k] = 0;   violated++; }
    if (State.W[k]  < 0)   { State.W[k]  = 0; violated++; }
    if (State.Sed[k] < 0)   { State.Sed[k] = 0; violated++; }
    if (State.windSed[k] < 0) { State.windSed[k] = 0; violated++; }
    if (!isFinite(H4[k])) { H4[k] = 0; violated++; }
    if (State.snowLayer[k] < 0) State.snowLayer[k] = 0;
    if (State.iceLayer[k]  < 0) State.iceLayer[k]  = 0;
    if (State.Aq[k] < 0)        State.Aq[k] = 0;
    if (State.Aq[k] > AQ_MAX)   State.Aq[k] = AQ_MAX;
    if (State.lavaBonus[k] < 0) State.lavaBonus[k] = 0;
  }
  Globals.simClampViolations += violated;
  return violated;
}

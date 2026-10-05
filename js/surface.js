// Surface processes: lithification (H1→H2→H3→H4) and weathering (reverse),
// plus the soil/gravel/soft-rock initialisers.

import { GRID, ICE } from './constants.js';
const { N, L, cellSize } = GRID;
const { AQ_MAX, ICE_FREEBORD_RATIO } = ICE;
import { State, Globals, H1, H2, H3, H4, surfaceField } from './state.js';
import { fbmTorus } from './noise.js';

/**
 * Initial soil depth for one cell. Below `seaLevel − 8` we just return
 * a thin constant; otherwise modulate by 3-octave FBM noise.
 * @param {number} idx  Cell index.
 * @returns {number}    Soil thickness in world units (≥ 0.05).
 */
export function initSoil(idx) {
  const t = State.targetSurface[idx];
  if (t < Globals.seaLevel - 8) return 0.05;
  const n = fbmTorus((idx % N) * cellSize, ((idx / N) | 0) * cellSize, 3, 6.0, Globals.worldSeed + 11);
  if (!isFinite(n)) {
    throw new Error(`initSoil[${idx}]: fbmTorus NaN, worldSeed=${Globals.worldSeed}, target=${t}`);
  }
  return Math.max(0.05, 0.5 + 0.4 * n);
}
/**
 * Initial gravel depth for one cell. Same shape as `initSoil` with a
 * deeper baseline and a different seed offset.
 * @param {number} idx  Cell index.
 * @returns {number}    Gravel thickness in world units (≥ 0.1).
 */
export function initGravel(idx) {
  const t = State.targetSurface[idx];
  if (t < Globals.seaLevel - 15) return 0.1;
  const n = fbmTorus((idx % N) * cellSize, ((idx / N) | 0) * cellSize, 3, 5.0, Globals.worldSeed + 22);
  if (!isFinite(n)) {
    throw new Error(`initGravel[${idx}]: fbmTorus NaN, worldSeed=${Globals.worldSeed}, target=${t}`);
  }
  return Math.max(0.1, 1.5 + 0.7 * n);
}
/**
 * Initial soft-rock depth for one cell. Same shape as `initSoil` /
 * `initGravel`, deeper still, with a third seed offset.
 * @param {number} idx  Cell index.
 * @returns {number}    Soft-rock thickness in world units (≥ 0.2).
 */
export function initSoftRock(idx) {
  const t = State.targetSurface[idx];
  if (t < Globals.seaLevel - 10) return 0.2;
  const n = fbmTorus((idx % N) * cellSize, ((idx / N) | 0) * cellSize, 3, 4.0, Globals.worldSeed + 33);
  if (!isFinite(n)) {
    throw new Error(`initSoftRock[${idx}]: fbmTorus NaN, worldSeed=${Globals.worldSeed}, target=${t}`);
  }
  return Math.max(0.2, 3.5 + 1.5 * n);
}

/**
 * Soil → gravel → soft rock → hard rock compaction over time, plus
 * reverse weathering when wet soil sits on top of stone. Underwater
 * lithification is much faster (sediment compaction) than land.
 *
 * @param {number} dt  Simulated time step in seconds.
 */
export function lithify(dt) {
  for (let k = 0; k < N * N; k++) {
    const surface = surfaceField[k];
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

/**
 * Sample the visible top of the column under world coordinates `(x, z)`,
 * with bilinear interpolation between the four surrounding cells. Adds
 * the snow layer on top of land, and ice freeboard above sea level for
 * ocean cells with sea ice.
 *
 * Used by the player controller to know what height to snap feet to.
 *
 * @param {number} x  World X coordinate (any real number; wrapped).
 * @param {number} z  World Z coordinate (any real number; wrapped).
 * @returns {number}  Visible top-of-column height. Falls back to
 *                    `seaLevel` if the result is NaN/Infinity.
 */
export function sampleHeight(x, z) {
  x = ((x % L) + L) % L;
  z = ((z % L) + L) % L;
  const fx = x / cellSize, fz = z / cellSize;
  const i0 = Math.floor(fx) % N, j0 = Math.floor(fz) % N;
  const i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
  const tx = fx - Math.floor(fx), tz = fz - Math.floor(fz);
  const top = k => {
    const s = surfaceField[k];
    if (s > Globals.seaLevel) return s + State.snowLayer[k];
    if (State.iceLayer[k] > 0.05) {
      return Globals.seaLevel + ICE_FREEBORD_RATIO * State.iceLayer[k] + State.snowLayer[k];
    }
    return s;
  };
  const result = ((top(j0 * N + i0) * (1 - tx) + top(j0 * N + i1) * tx) * (1 - tz)
                + (top(j1 * N + i0) * (1 - tx) + top(j1 * N + i1) * tx) * tz);
  // Safety: never return NaN — would propagate into the player physics and
  // drop them through the world. Fall back to sea level.
  return isFinite(result) ? result : Globals.seaLevel;
}

/**
 * NaN safety net at the end of every simulation step.
 *
 * Height layers (H1..H4) can be legitimately negative — that's where
 * ocean trenches live. We only reset NaN/Infinity to 0, never clamp to
 * a non-negative value. Flux arrays (W, Sed, Aq, …) are physically
 * ≥ 0 and get clamped to 0 on negative + non-finite.
 *
 * @returns {number} Number of clamp events that actually fired.
 */
export function clampSafety() {
  let violated = 0;
  for (let k = 0; k < N * N; k++) {
    if (!isFinite(H1[k])) { H1[k] = 0; violated++; }
    if (!isFinite(H2[k])) { H2[k] = 0; violated++; }
    if (!isFinite(H3[k])) { H3[k] = 0; violated++; }
    if (!isFinite(H4[k])) { H4[k] = 0; violated++; }
    if (!isFinite(State.Fmag[k]))     State.Fmag[k] = 0;
    if (!isFinite(State.W[k])         || State.W[k] < 0)         { State.W[k] = 0; if (!isFinite(State.W[k])) violated++; }
    if (!isFinite(State.Sed[k])       || State.Sed[k] < 0)       { State.Sed[k] = 0; if (!isFinite(State.Sed[k])) violated++; }
    if (!isFinite(State.windSed[k])   || State.windSed[k] < 0)   { State.windSed[k] = 0; if (!isFinite(State.windSed[k])) violated++; }
    if (!isFinite(State.snowLayer[k]) || State.snowLayer[k] < 0) State.snowLayer[k] = 0;
    if (!isFinite(State.iceLayer[k])  || State.iceLayer[k]  < 0) State.iceLayer[k]  = 0;
    if (!isFinite(State.Aq[k]))        State.Aq[k] = 0;
    else if (State.Aq[k] < 0)          State.Aq[k] = 0;
    else if (State.Aq[k] > AQ_MAX)     State.Aq[k] = AQ_MAX;
    if (!isFinite(State.lavaBonus[k]) || State.lavaBonus[k] < 0) State.lavaBonus[k] = 0;
    if (!isFinite(State.eruptHeat[k]))  State.eruptHeat[k] = 0;
    if (!isFinite(State.ashLayer[k]))    State.ashLayer[k] = 0;
    if (!isFinite(State.flowAccumRouting[k])) State.flowAccumRouting[k] = 0;
    if (!isFinite(State.spillLevel[k])) State.spillLevel[k] = 0;
  }
  Globals.simClampViolations += violated;
  return violated;
}

// Snow / sea ice / glacier step: growth, melt, compaction, and the small
// "Aq + W" boost that feeds meltwater back into rivers and aquifers.

import { GRID, CLIMATE, ICE } from './constants.js';
const { N, cellSize } = GRID;
const { ICE_TEMP, SNOW_TEMP, MELT_BAND_T } = CLIMATE;
const { ICE_FORM_RATE, ICE_MELT_RATE, ICE_MAX_LAYER,
        SNOW_MAX, ICE_ACCUM, MELT_RATE,
        SNOW_COMPACT_RATE, SNOW_TO_ICE_RATIO,
        MELT_TO_W, MELT_TO_AQ, AQ_MAX } = ICE;
import { State, Globals, H1, H2, H3, H4, surfaceField } from './state.js';

// One combined step covering sea-ice growth/melt, snow accumulation/melt,
// snow→ice compaction and meltwater routing.
export function glacierStep(dt, t) {
  for (let j = 0; j < N; j++) {
    const jN = (j + 1) % N, jS = (j - 1 + N) % N;
    const rowC = j * N, rowN = jN * N, rowS = jS * N;
    for (let i = 0; i < N; i++) {
      const iE = (i + 1) % N, iW = (i - 1 + N) % N, idx = rowC + i;
      const temp = State.temperature[idx];
      const surface = surfaceField[idx];
      const isOcean = surface < Globals.seaLevel;

      // Slope factor — snow sticks to flat ground.
      const hE = surfaceField[rowC + iE];
      const hW = surfaceField[rowC + iW];
      const hU = surfaceField[rowN + i ];
      const hD = surfaceField[rowS + i ];
      const dhdx = (hE - hW) / (2 * cellSize);
      const dhdz = (hU - hD) / (2 * cellSize);
      const slope = Math.hypot(dhdx, dhdz);
      const slopeFactor = Math.max(0, 1 - slope / 1.5);

      // 1. Sea ice — grow above ICE_TEMP, melt below.
      if (isOcean) {
        if (temp < ICE_TEMP) {
          const coldFactor = Math.min(1, (ICE_TEMP - temp) / 0.15);
          const accum = ICE_FORM_RATE * coldFactor * dt;
          State.iceLayer[idx] = Math.min(ICE_MAX_LAYER, State.iceLayer[idx] + accum);
        } else if (temp > ICE_TEMP + 0.02) {
          const warm = Math.min(1, (temp - ICE_TEMP) / 0.15);
          State.iceLayer[idx] = Math.max(0, State.iceLayer[idx] - ICE_MELT_RATE * warm * dt);
        }
      } else {
        if (State.iceLayer[idx] > 0) {
          State.iceLayer[idx] = Math.max(0, State.iceLayer[idx] - ICE_MELT_RATE * 2 * dt);
        }
      }

      // 2. Snow — accumulate when cold and the surface can hold snow.
      const hasSolidTop = !isOcean || State.iceLayer[idx] > 0.05;
      if (temp < SNOW_TEMP && hasSolidTop) {
        const coldFactor = Math.min(1, (SNOW_TEMP - temp) / 0.15);
        const accum = ICE_ACCUM * slopeFactor * (0.3 + 0.7 * coldFactor) * dt;
        const headroom = SNOW_MAX - State.snowLayer[idx];
        State.snowLayer[idx] += Math.min(accum, headroom);
      } else if (temp < SNOW_TEMP + MELT_BAND_T && State.snowLayer[idx] > 0) {
        const melt = (temp - SNOW_TEMP) / MELT_BAND_T;
        const meltAmt = MELT_RATE * melt * dt;
        const fromSnow = Math.min(State.snowLayer[idx], meltAmt);
        State.snowLayer[idx] -= fromSnow;
        if (!isOcean && fromSnow > 0) {
          State.W[idx] += fromSnow * MELT_TO_W;
          State.Aq[idx] = Math.min(AQ_MAX, State.Aq[idx] + fromSnow * MELT_TO_AQ);
        }
      } else if (temp >= SNOW_TEMP + MELT_BAND_T && State.snowLayer[idx] > 0) {
        const meltAmt = MELT_RATE * dt;
        const fromSnow = Math.min(State.snowLayer[idx], meltAmt);
        State.snowLayer[idx] -= fromSnow;
        if (!isOcean && fromSnow > 0) {
          State.W[idx] += fromSnow * MELT_TO_W;
          State.Aq[idx] = Math.min(AQ_MAX, State.Aq[idx] + fromSnow * MELT_TO_AQ);
        }
      }

      // 3. Snow → ice compaction once there's enough weight.
      if (State.iceLayer[idx] > 0.05 && State.snowLayer[idx] > 0.3) {
        const compact = Math.min(State.snowLayer[idx] - 0.1, SNOW_COMPACT_RATE * dt);
        if (compact > 0) {
          State.snowLayer[idx] -= compact;
          State.iceLayer[idx] = Math.min(ICE_MAX_LAYER, State.iceLayer[idx] + compact * SNOW_TO_ICE_RATIO);
        }
      }
    }
  }
}

// Wind: advect suspended sediment, then erode or deposit against the
// transport capacity dictated by the local slope and humidity.

import { GRID, WIND } from './constants.js';
const { N, cellSize } = GRID;
const { SPEED: WIND_SPEED, CAP_BASE: WIND_CAP_BASE, CAP_SLOPE: WIND_CAP_SLOPE,
        K_ERODE: K_WIND_ERODE, K_DEPOSIT: K_WIND_DEPOSIT,
        MAX_ERODE: MAX_WIND_ERODE } = WIND;
import { State, Globals, H1, H2, H3, H4, surfaceField } from './state.js';
import { windDirX, windDirZ } from './climate.js';

// Semi-Lagrangian advection with CFL sub-stepping when wind is large.
export function windAdvect(dt) {
  State.windSedB.set(State.windSed);
  for (let j = 0; j < N; j++) {
    const wX = windDirX(j);
    const wZ = windDirZ(j);
    const vx = wX * WIND_SPEED * dt / cellSize;
    const vz = wZ * WIND_SPEED * dt / cellSize;
    const cfl = Math.abs(vx) + Math.abs(vz);
    const s = cfl > 0.9 ? 0.9 / cfl : 1;
    const vxs = vx * s, vzs = vz * s;
    const rowC = j * N;
    for (let i = 0; i < N; i++) {
      let sx = i - vxs, sz = j - vzs;
      sx = ((sx % N) + N) % N; sz = ((sz % N) + N) % N;
      const i0 = Math.floor(sx), j0 = Math.floor(sz);
      const i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
      const tx = sx - i0, tz = sz - j0;
      const a = State.windSedB[j0 * N + i0], b = State.windSedB[j0 * N + i1];
      const c = State.windSedB[j1 * N + i0], d = State.windSedB[j1 * N + i1];
      State.windSed[rowC + i] = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }
  }
}

// Pick up loose dry soil on windward slopes, drop it on leeward/flat ground.
export function windErodeDeposit(dt, t) {
  const strength = 0.7 + 0.3 * Math.sin(t * 0.11);
  for (let j = 0; j < N; j++) {
    const wX = windDirX(j);
    const wZ = windDirZ(j);
    const jN = (j + 1) % N, jS = (j - 1 + N) % N;
    const rowC = j * N, rowN = jN * N, rowS = jS * N;
    for (let i = 0; i < N; i++) {
      const iE = (i + 1) % N, iW = (i - 1 + N) % N, idx = rowC + i;
      const hE = surfaceField[rowC + iE];
      const hW = surfaceField[rowC + iW];
      const hU = surfaceField[rowN + i ];
      const hD = surfaceField[rowS + i ];
      const dhdx = (hE - hW) / (2 * cellSize), dhdz = (hU - hD) / (2 * cellSize);
      const dh_dw = dhdx * wX + dhdz * wZ;
      let cap = (WIND_CAP_BASE + WIND_CAP_SLOPE * Math.max(0, -dh_dw)) * strength;
      if (cap < 0) cap = 0;
      const wv = State.W[idx];
      const dry = wv < 0.02 ? 1 : (wv < 0.10 ? 0.2 : 0);
      const hum = State.humidity[idx];
      const erosionMul = 1 + 2.0 * (1 - hum);
      const depositMul = 1 + 3.0 * hum;
      const s = State.windSed[idx];
      if (cap > s) {
        let amount = (cap - s) * K_WIND_ERODE * dt * dry * erosionMul;
        if (amount > MAX_WIND_ERODE) amount = MAX_WIND_ERODE;
        if (amount > 0) {
          const e = Math.min(H1[idx], amount);
          if (e > 0) { H1[idx] -= e; State.windSed[idx] += e; }
        }
      } else if (s > cap) {
        let amount = (s - cap) * K_WIND_DEPOSIT * dt * depositMul;
        if (amount > s) amount = s;
        if (amount > 0) { H1[idx] += amount; State.windSed[idx] -= amount; }
      }
    }
  }
}

// Drain any in-flight suspended sediment back into the soil column
// (used when the user toggles wind off).
export function dropWindSed() {
  for (let k = 0; k < N * N; k++) {
    if (State.windSed[k] > 0) {
      H1[k] += State.windSed[k];
      State.windSed[k] = 0;
    }
  }
}

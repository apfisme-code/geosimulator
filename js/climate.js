// Climate: humidity BFS from water/ice edges, rain shadow along wind,
// ocean currents, seasonal temperature, and adaptive sea level.

import {
  N, cellSize, TAU, L,
  SHADOW_STEPS, SHADOW_K,
  HUMIDITY_FALLOFF, TEMP_ALT_LAPSE,
  SEASON_AMP, SEASON_RATE,
  OCEAN_CURRENT_RANGE, COLD_CURRENT, WARM_CURRENT,
  SEA_TEMP_GAIN, SEA_SMOOTH, T_REF_ALPHA,
  SEA_LEVEL_MIN, SEA_LEVEL_MAX,
} from './constants.js';
import { DIRS } from './constants.js';
import { State, Globals, H1, H2, H3, H4 } from './state.js';
import { fbmTorus } from './noise.js';

// Wind direction at latitude j — pure function, exported for wind/ice modules too.
export function windDirX(j) { return -Math.cos(4 * Math.PI * j / N); }
export function windDirZ(j) { return  0.25 * Math.sin(4 * Math.PI * j / N); }

// BFS distance to the nearest water/ice edge; humidity falls off exponentially
// with that distance, and is suppressed on the lee side of high terrain.
export function computeClimate(t) {
  // 1. Distance to water (BFS from any cell that holds water or ice)
  State.humDist.fill(1e9);
  let head = 0, tail = 0;
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    if (surface < Globals.seaLevel || State.W[k] > 0.05 || State.iceLayer[k] > 0.05) {
      State.humDist[k] = 0;
      State.bfsQueue[tail++] = k;
    }
  }
  while (head < tail) {
    const k = State.bfsQueue[head++];
    const i = k % N, j = (k / N) | 0;
    const d = State.humDist[k] + 1;
    for (let dd = 0; dd < 4; dd++) {
      const ni = ((i + DIRS[dd][0]) % N + N) % N;
      const nj = ((j + DIRS[dd][1]) % N + N) % N;
      const nk = nj * N + ni;
      if (State.humDist[nk] > d) { State.humDist[nk] = d; State.bfsQueue[tail++] = nk; }
    }
  }

  // 2. Rain shadow: max upwind barrier within SHADOW_STEPS cells.
  for (let j = 0; j < N; j++) {
    const wX = windDirX(j);
    const wZ = windDirZ(j);
    const stepX = wX * 4;
    const stepZ = wZ * 4;
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const h = H1[k] + H2[k] + H3[k] + H4[k];
      let maxBarrier = 0;
      for (let s = 1; s <= SHADOW_STEPS; s++) {
        const ni = ((i - Math.round(stepX * s)) % N + N) % N;
        const nj = ((j - Math.round(stepZ * s)) % N + N) % N;
        const nk = nj * N + ni;
        const nh = H1[nk] + H2[nk] + H3[nk] + H4[nk];
        const barrier = nh - h;
        if (barrier > maxBarrier) maxBarrier = barrier;
      }
      State.rainShadow[k] = Math.exp(-maxBarrier / SHADOW_K);
    }
  }

  // 3. Combine distance + river routing + noise, apply rain shadow.
  for (let k = 0; k < N * N; k++) {
    const distHum = Math.exp(-State.humDist[k] / HUMIDITY_FALLOFF);
    const riverTerm = Math.min(1, Math.log(1 + State.flowAccumRouting[k]) / Math.log(1 + 200)) * 0.7;
    const x = (k % N) * cellSize;
    const z = ((k / N) | 0) * cellSize;
    const noise = 0.5 + 0.5 * fbmTorus(x, z, 3, 2.0, Globals.worldSeed + 555);
    let h = (0.15 + 0.55 * distHum + riverTerm + 0.15 * noise) * State.rainShadow[k];
    if (h > 1) h = 1;
    if (h < 0) h = 0;
    State.humidity[k] = h;
  }

  // 4. Ocean currents: warm east-bound, cold west-bound at coastlines.
  State.currentT.fill(0);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const surface = H1[k] + H2[k] + H3[k] + H4[k];
      if (surface > Globals.seaLevel - 2) continue;
      let westLand = false, eastLand = false;
      for (let s = 1; s <= OCEAN_CURRENT_RANGE; s++) {
        const nw = ((i - s) % N + N) % N;
        const ne = ((i + s) % N + N) % N;
        const kw = j * N + nw, ke = j * N + ne;
        if (H1[kw] + H2[kw] > Globals.seaLevel) westLand = true;
        if (H1[ke] + H2[ke] > Globals.seaLevel) eastLand = true;
      }
      if (westLand)      State.currentT[k] = COLD_CURRENT;
      else if (eastLand) State.currentT[k] = WARM_CURRENT;
    }
  }

  // 5. Temperature = latitude * (1 - lapse*alt) + current + heat, with seasonal shift.
  const seasonOffset = SEASON_AMP * Math.sin(t * SEASON_RATE);
  for (let k = 0; k < N * N; k++) {
    const z = ((k / N) | 0) * cellSize;
    const zShift = z + seasonOffset;
    const lat = 0.5 + 0.5 * Math.cos(TAU * zShift / L);
    const h = H1[k] + H2[k] + H3[k] + H4[k];
    const alt = Math.max(0, h) / 80;
    let t2 = lat * (1 - TEMP_ALT_LAPSE * alt) + State.currentT[k];
    t2 += State.eruptHeat[k] * 0.35;
    if (t2 < 0) t2 = 0;
    if (t2 > 1) t2 = 1;
    State.temperature[k] = t2;
  }
}

// Adapt sea level toward a target driven by the global temperature anomaly.
export function updateSeaLevel() {
  let tSum = 0;
  for (let k = 0; k < N * N; k++) tSum += State.temperature[k];
  const tAvg = tSum / (N * N);
  Globals.tRef += (tAvg - Globals.tRef) * T_REF_ALPHA;
  const anomaly = tAvg - Globals.tRef;
  let target = -SEA_TEMP_GAIN * anomaly;
  if (target < SEA_LEVEL_MIN) target = SEA_LEVEL_MIN;
  if (target > SEA_LEVEL_MAX) target = SEA_LEVEL_MAX;
  Globals.seaLevel += (target - Globals.seaLevel) * SEA_SMOOTH;
  if (Globals.seaLevel < SEA_LEVEL_MIN) Globals.seaLevel = SEA_LEVEL_MIN;
  if (Globals.seaLevel > SEA_LEVEL_MAX) Globals.seaLevel = SEA_LEVEL_MAX;
}

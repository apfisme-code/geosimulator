// Tectonic plates: Worley noise for ownership, drift, lifecycle,
// boundary-driven ridges/trenches/arcs, mantle field, target surface.

import { GRID, PLATES } from './constants.js';
const { N, cellSize, TAU, L, wrap, wrapRel } = GRID;
const {
  COUNT: PLATE_COUNT, MAX: MAX_PLATES,
  OCEAN_FRACTION,
  CONT_TARGET_MIN, CONT_TARGET_MAX, OCEAN_TARGET_MIN, OCEAN_TARGET_MAX,
  MIN_PLATE_AREA, SPLIT_AREA_MIN, SPLIT_PROB,
  SPLIT_MANTLE_MIN, SPLIT_OFFSET_MIN, SPLIT_OFFSET_MAX,
  BLEND_WIDTH, RIDGE_WIDTH,
  RIDGE_MAX, RIFT_MAX, TRENCH_MAX, ARC_MAX, ARC_OFFSET, ARC_SIG,
  TRENCH_SIG, MID_RIDGE_MAX, AXIAL_RIFT_MAX,
  VN_SCALE: PLATE_VN_SCALE, VN_THRESHOLD,
  DETAIL_AMP, DETAIL_FREQ, DETAIL_OCT,
  PLATEAU_MAX, PLATEAU_OFFSET, PLATEAU_SIG,
  MANTLE_DRIFT,
} = PLATES;
import { State, Globals } from './state.js';
import { vnoise4, fbmTorus } from './noise.js';

// ---------- Initialisation ----------
/**
 * Spawn `PLATE_COUNT` random plates at fresh positions, types and drift
 * velocities. Called once from `resetTerrain`. The remaining slots up to
 * `MAX_PLATES` stay `active = 0` until a split needs them.
 */
export function initPlates() {
  for (let k = 0; k < PLATE_COUNT; k++) spawnRandomPlate(k);
}

/**
 * Populate one plate slot in-place with a fresh random centre, type,
 * base height, hilliness bias, drift velocity, and active flag.
 * @param {number} slot  Plate index to write into.
 */
function spawnRandomPlate(slot) {
  State.plateCX[slot] = Math.random() * L;
  State.plateCZ[slot] = Math.random() * L;
  const isOcean = Math.random() < OCEAN_FRACTION;
  if (isOcean) {
    State.plateType[slot]  = 0;
    State.plateH[slot]     = OCEAN_TARGET_MIN + Math.random() * (OCEAN_TARGET_MAX - OCEAN_TARGET_MIN);
    State.plateHills[slot] = Math.random() * 0.15;
  } else {
    State.plateType[slot]  = 1;
    const hills = Math.random();
    State.plateHills[slot] = hills;
    State.plateH[slot]     = CONT_TARGET_MIN + hills * (CONT_TARGET_MAX - CONT_TARGET_MIN);
  }
  const ang = Math.random() * TAU;
  const spd = 0.05 + Math.random() * 0.15;
  State.plateDriftVX[slot] = Math.cos(ang) * spd;
  State.plateDriftVZ[slot] = Math.sin(ang) * spd;
  State.plateActive[slot]  = 1;
}

/**
 * Mark a plate slot as inactive. Its array entries are left in place so
 * the next spawn/split can pick them up; only `plateActive[k]` is cleared.
 * @param {number} k  Plate slot index.
 */
function deactivatePlate(k) {
  State.plateActive[k] = 0;
}

/**
 * Count the plates currently marked active. Used by the HUD and by
 * `stepDrift` to track births/deaths.
 * @returns {number} Number of plates with `plateActive[k] === 1`.
 */
export function countActivePlates() {
  let c = 0;
  for (let k = 0; k < MAX_PLATES; k++) if (State.plateActive[k]) c++;
  return c;
}

/**
 * Drift every active plate by its velocity for `dts` simulated seconds,
 * wrapping the centre position on the torus so plates that drift off the
 * east edge reappear from the west.
 * @param {number} dts  Elapsed simulated seconds for this step (typically
 *                      `DRIFT_INTERVAL * dt`).
 */
export function driftPlates(dts) {
  for (let k = 0; k < MAX_PLATES; k++) {
    if (!State.plateActive[k]) continue;
    State.plateCX[k] = wrap(State.plateCX[k] + State.plateDriftVX[k] * dts);
    State.plateCZ[k] = wrap(State.plateCZ[k] + State.plateDriftVZ[k] * dts);
  }
}

/**
 * Per-tick plate lifecycle:
 *   1. Deactivate any active plate whose cell count dropped below
 *      `MIN_PLATE_AREA` (eaten by neighbours).
 *   2. With probability `SPLIT_PROB` per big active plate, find the cell
 *      with the highest mantleField inside its CSR cell list and spawn a
 *      child plate offset from it. The Worley fields are then rebuilt
 *      so the new plate immediately takes its share of cells.
 *
 * Uses `plateCellsStart`/`plateCellsCount`/`plateCellsIdx` for O(area)
 * scans of each plate's cells instead of O(N²).
 */
export function updatePlateLifecycle() {
  // 1. Deactivate tiny plates using plateCellsCount[k] as the area.
  for (let k = 0; k < MAX_PLATES; k++) {
    if (State.plateActive[k] && State.plateCellsCount[k] < MIN_PLATE_AREA) deactivatePlate(k);
  }
  // 2. Try to split a few big ones.
  for (let k = 0; k < MAX_PLATES; k++) {
    if (!State.plateActive[k]) continue;
    if (State.plateCellsCount[k] < SPLIT_AREA_MIN) continue;
    if (Math.random() > SPLIT_PROB) continue;
    let bestIdx = -1, bestM = SPLIT_MANTLE_MIN;
    const start = State.plateCellsStart[k];
    const count = State.plateCellsCount[k];
    const idxs  = State.plateCellsIdx;
    const mf    = State.mantleField;
    for (let s = 0; s < count; s++) {
      const kk = idxs[start + s];
      if (mf[kk] > bestM) { bestM = mf[kk]; bestIdx = kk; }
    }
    if (bestIdx < 0) continue;
    let slot = -1;
    for (let s = 0; s < MAX_PLATES; s++) if (!State.plateActive[s]) { slot = s; break; }
    if (slot < 0) continue;
    const x = (bestIdx % N) * cellSize;
    const z = ((bestIdx / N) | 0) * cellSize;
    const offAng  = Math.random() * TAU;
    const offDist = SPLIT_OFFSET_MIN + Math.random() * (SPLIT_OFFSET_MAX - SPLIT_OFFSET_MIN);
    State.plateCX[slot]      = wrap(x + Math.cos(offAng) * offDist);
    State.plateCZ[slot]      = wrap(z + Math.sin(offAng) * offDist);
    State.plateH[slot]       = State.plateH[k];
    State.plateType[slot]    = State.plateType[k];
    State.plateHills[slot]   = State.plateHills[k];
    const pAng = Math.random() * TAU;
    const pSpd = 0.03 + Math.random() * 0.06;
    State.plateDriftVX[slot] = State.plateDriftVX[k] + Math.cos(pAng) * pSpd;
    State.plateDriftVZ[slot] = State.plateDriftVZ[k] + Math.sin(pAng) * pSpd;
    State.plateActive[slot]  = 1;
    computeWorleyFields();
    break;
  }
}

// ---------- Worley noise ----------
/**
 * Rebuild all plate-derived fields for every cell:
 *   - `plateK1`/`plateK2` (nearest / 2nd-nearest plate index)
 *   - `plateF1`/`plateF2` (nearest / 2nd-nearest distance)
 *   - `plateH_A`/`plateH_B`, `plateTypeA`/`plateTypeB`, `plateHillsA`/`plateHillsB`
 *     (cached per-plate fields for the two owners, used by the target surface assembly)
 *   - per-plate CSR cell lists (`plateCellsStart`/`Count`/`Idx`)
 *   - `targetSurface` assembled from plate heights, boundary effects,
 *     continental divergent plateaus, detail noise, and the existing
 *     `lavaBonus`.
 *
 * This is O(N² × MAX_PLATES) for the ownership pass and O(N²) for the
 * cell lists and target assembly — runs every `DRIFT_INTERVAL` ticks,
 * after `driftPlates` has moved the centres.
 */
export function computeWorleyFields() {
  const K1 = State.plateK1, K2 = State.plateK2;
  const F1 = State.plateF1, F2 = State.plateF2;
  const HA = State.plateH_A, HB = State.plateH_B;
  const TA = State.plateTypeA, TB = State.plateTypeB;
  const HiA = State.plateHillsA, HiB = State.plateHillsB;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i * cellSize, z = j * cellSize;
      let b1 = Infinity, b2 = Infinity, k1 = -1, k2 = -1;
      for (let k = 0; k < MAX_PLATES; k++) {
        if (!State.plateActive[k]) continue;
        const dx = wrapRel(State.plateCX[k] - x), dz = wrapRel(State.plateCZ[k] - z);
        const d2 = dx * dx + dz * dz;
        if (d2 < b1)      { b2 = b1; k2 = k1; b1 = d2; k1 = k; }
        else if (d2 < b2) { b2 = d2; k2 = k; }
      }
      const idx = j * N + i;
      if (k1 < 0) {
        F1[idx] = 1e9; F2[idx] = 1e9;
        K1[idx] = -1;  K2[idx] = -1;
        HA[idx] = 0;   HB[idx] = 0;
        TA[idx] = 1;   TB[idx] = 1;
        HiA[idx] = 0;  HiB[idx] = 0;
        continue;
      }
      F1[idx]  = Math.sqrt(b1);
      F2[idx]  = Math.sqrt(Math.max(b2, 0));
      K1[idx]  = k1;
      K2[idx]  = k2 < 0 ? k1 : k2;
      HA[idx]  = State.plateH[k1];
      HB[idx]  = State.plateH[K2[idx]];
      TA[idx]  = State.plateType[k1];
      TB[idx]  = State.plateType[K2[idx]];
      HiA[idx] = State.plateHills[k1];
      HiB[idx] = State.plateHills[K2[idx]];
    }
  }

  // Rebuild per-plate cell lists (CSR): count, then prefix sum → starts,
  // then fill plateCellsIdx. Cost is O(N²) but only runs every 60 ticks.
  State.plateCellsCount.fill(0);
  for (let k = 0; k < N * N; k++) {
    const pk = K1[k];
    if (pk >= 0) State.plateCellsCount[pk]++;
  }
  {
    let acc = 0;
    const start = State.plateCellsStart;
    const count = State.plateCellsCount;
    for (let k = 0; k < MAX_PLATES; k++) {
      start[k] = acc;
      acc += count[k];
    }
  }
  {
    // Scratch counter so the second pass doesn't clobber cells in flight.
    const cursor = State.plateCellsCount;
    cursor.fill(0);
    for (let k = 0; k < N * N; k++) {
      const pk = K1[k];
      if (pk < 0) continue;
      State.plateCellsIdx[State.plateCellsStart[pk] + cursor[pk]++] = k;
    }
  }

  // Assemble targetSurface (heights + boundaries + plateaus + detail + lava bonus)
  const K1b = State.plateK1, K2b = State.plateK2;
  const TGT = State.targetSurface;
  for (let j = 0; j < N; j++) {
    const z = j * cellSize;
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const k1 = K1b[k], k2 = K2b[k];
      if (k1 < 0) { TGT[k] = 0; continue; }
      const tA = TA[k], tB = TB[k];
      const edge = F2[k] - F1[k];
      const wA = 0.5 + 0.5 * Math.tanh(edge / BLEND_WIDTH);
      const hA = HA[k], hB = HB[k];
      const hBlend = wA * hA + (1 - wA) * hB;

      const dx = wrapRel(State.plateCX[k2] - State.plateCX[k1]);
      const dz = wrapRel(State.plateCZ[k2] - State.plateCZ[k1]);
      const dNorm = Math.hypot(dx, dz) || 1;
      const nx = dx / dNorm, nz = dz / dNorm;
      const vRelX = State.plateDriftVX[k2] - State.plateDriftVX[k1];
      const vRelZ = State.plateDriftVZ[k2] - State.plateDriftVZ[k1];
      const vn = vRelX * nx + vRelZ * nz;
      const vnNorm = Math.max(-1, Math.min(1, vn / PLATE_VN_SCALE));

      const boundary = Math.exp(-edge * edge / (2 * RIDGE_WIDTH * RIDGE_WIDTH));
      let boundaryHeight = 0;
      if (vnNorm < -VN_THRESHOLD) {
        const conv = -vnNorm;
        if      (tA === 1 && tB === 1) boundaryHeight = RIDGE_MAX * conv * boundary;
        else if (tA === 0 && tB === 0) boundaryHeight = -TRENCH_MAX * 0.7 * conv * boundary;
        else if (tA === 0) {
          boundaryHeight = -TRENCH_MAX * conv *
            Math.exp(-edge * edge / (2 * TRENCH_SIG * TRENCH_SIG));
        } else {
          const d = edge - ARC_OFFSET;
          boundaryHeight = ARC_MAX * conv *
            Math.exp(-d * d / (2 * ARC_SIG * ARC_SIG));
        }
      } else if (vnNorm > VN_THRESHOLD) {
        const div = vnNorm;
        if (tA === 1 && tB === 1) boundaryHeight = -RIFT_MAX * div * boundary;
        else if (tA === 0 && tB === 0) {
          const midRidge  = MID_RIDGE_MAX * div * boundary;
          const axialRift = -AXIAL_RIFT_MAX * div *
            Math.exp(-edge * edge / (2 * 8 * 8));
          boundaryHeight = midRidge + axialRift;
        }
      }

      let plateau = 0;
      if (vnNorm > VN_THRESHOLD && tA === 1 && tB === 1) {
        const d = Math.abs(edge - PLATEAU_OFFSET);
        plateau = PLATEAU_MAX * vnNorm * Math.exp(-d * d / (2 * PLATEAU_SIG * PLATEAU_SIG));
      }

      const x = i * cellSize;
      const hillsBlend = wA * HiA[k] + (1 - wA) * HiB[k];
      const detailNoise = fbmTorus(x, z, DETAIL_OCT, DETAIL_FREQ, Globals.worldSeed + 777);
      const detail = DETAIL_AMP * (0.3 + 0.7 * hillsBlend) * detailNoise;

      TGT[k] = hBlend + boundaryHeight + plateau + detail;
    }
  }

  // Lava is part of the permanent target — relaxation must not eat the cone.
  const TGT2 = State.targetSurface, LBO = State.lavaBonus;
  for (let k = 0; k < N * N; k++) TGT2[k] += LBO[k];
}

/**
 * Slowly drifting low-frequency noise driving volcanism and per-cell
 * uplift. The same input sample (`*1.4`) is offset by `(ox, oy)` that
 * orbit a small circle, so the noise field evolves smoothly in time
 * without ever repeating exactly.
 *
 * @param {number} t  Simulated time (seconds since world reset).
 */
export function computeMantleField(t) {
  const ox = Math.cos(t * MANTLE_DRIFT) * 4.0;
  const oy = Math.sin(t * MANTLE_DRIFT) * 4.0;
  const TAU_INV = TAU / L;
  for (let j = 0; j < N; j++) {
    const z = j * cellSize;
    const v = z * TAU_INV;
    const cv14 = Math.cos(v) * 1.4;
    const sv14 = Math.sin(v) * 1.4;
    for (let i = 0; i < N; i++) {
      const x = i * cellSize;
      const u = x * TAU_INV;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      State.mantleField[j * N + i] = vnoise4(cu * 1.4 + ox, su * 1.4 + oy,
                                            cv14 - ox, sv14 + oy,
                                            Globals.worldSeed + 999);
    }
  }
}

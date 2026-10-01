// Tectonic plates: Worley noise for ownership, drift, lifecycle,
// boundary-driven ridges/trenches/arcs, mantle field, target surface.

import {
  N, cellSize, TAU, L, wrap, wrapRel,
  MAX_PLATES, PLATE_COUNT, OCEAN_FRACTION,
  CONT_TARGET_MIN, CONT_TARGET_MAX, OCEAN_TARGET_MIN, OCEAN_TARGET_MAX,
  MIN_PLATE_AREA, SPLIT_AREA_MIN, SPLIT_PROB,
  SPLIT_MANTLE_MIN, SPLIT_OFFSET_MIN, SPLIT_OFFSET_MAX,
  BLEND_WIDTH, RIDGE_WIDTH,
  RIDGE_MAX, RIFT_MAX, TRENCH_MAX, ARC_MAX, ARC_OFFSET, ARC_SIG,
  TRENCH_SIG, MID_RIDGE_MAX, AXIAL_RIFT_MAX,
  PLATE_VN_SCALE, VN_THRESHOLD,
  DETAIL_AMP, DETAIL_FREQ, DETAIL_OCT,
  PLATEAU_MAX, PLATEAU_OFFSET, PLATEAU_SIG,
  MANTLE_DRIFT,
} from './constants.js';
import { State, Globals } from './state.js';
import { vnoise4, fbmTorus } from './noise.js';

// Per-plate state lives directly on State (see state.js); the
// `plates` alias keeps the rest of this file readable.
const plates = State;

// ---------- Initialisation ----------
export function initPlates() {
  const p = plates;
  for (let k = 0; k < PLATE_COUNT; k++) spawnRandomPlate(k);
}

function spawnRandomPlate(slot) {
  const p = plates;
  p.plateCX[slot] = Math.random() * L;
  p.plateCZ[slot] = Math.random() * L;
  const isOcean = Math.random() < OCEAN_FRACTION;
  if (isOcean) {
    p.plateType[slot]  = 0;
    p.plateH[slot]     = OCEAN_TARGET_MIN + Math.random() * (OCEAN_TARGET_MAX - OCEAN_TARGET_MIN);
    p.plateHills[slot] = Math.random() * 0.15;
  } else {
    p.plateType[slot]  = 1;
    const hills = Math.random();
    p.plateHills[slot] = hills;
    p.plateH[slot]     = CONT_TARGET_MIN + hills * (CONT_TARGET_MAX - CONT_TARGET_MIN);
  }
  const ang = Math.random() * TAU;
  const spd = 0.05 + Math.random() * 0.15;
  p.plateDriftVX[slot] = Math.cos(ang) * spd;
  p.plateDriftVZ[slot] = Math.sin(ang) * spd;
  p.plateActive[slot]  = 1;
}

function deactivatePlate(k) {
  plates.plateActive[k] = 0;
}

export function countActivePlates() {
  const p = plates;
  let c = 0;
  for (let k = 0; k < MAX_PLATES; k++) if (p.plateActive[k]) c++;
  return c;
}

// Drift all plates by their velocity for `dts` simulated seconds.
export function driftPlates(dts) {
  const p = plates;
  for (let k = 0; k < MAX_PLATES; k++) {
    if (!p.plateActive[k]) continue;
    p.plateCX[k] = wrap(p.plateCX[k] + p.plateDriftVX[k] * dts);
    p.plateCZ[k] = wrap(p.plateCZ[k] + p.plateDriftVZ[k] * dts);
  }
}

// Per-step: deactivate tiny plates, occasionally split big ones.
export function updatePlateLifecycle() {
  const p = plates;
  p.plateArea.fill(0);
  for (let k = 0; k < N * N; k++) {
    const k1 = p.plateK1[k];
    if (k1 >= 0 && p.plateActive[k1]) p.plateArea[k1]++;
  }
  for (let k = 0; k < MAX_PLATES; k++) {
    if (p.plateActive[k] && p.plateArea[k] < MIN_PLATE_AREA) deactivatePlate(k);
  }
  for (let k = 0; k < MAX_PLATES; k++) {
    if (!p.plateActive[k]) continue;
    if (p.plateArea[k] < SPLIT_AREA_MIN) continue;
    if (Math.random() > SPLIT_PROB) continue;
    let bestIdx = -1, bestM = SPLIT_MANTLE_MIN;
    for (let kk = 0; kk < N * N; kk++) {
      if (p.plateK1[kk] !== k) continue;
      if (State.mantleField[kk] > bestM) { bestM = State.mantleField[kk]; bestIdx = kk; }
    }
    if (bestIdx < 0) continue;
    let slot = -1;
    for (let s = 0; s < MAX_PLATES; s++) if (!p.plateActive[s]) { slot = s; break; }
    if (slot < 0) continue;
    const x = (bestIdx % N) * cellSize;
    const z = ((bestIdx / N) | 0) * cellSize;
    const offAng  = Math.random() * TAU;
    const offDist = SPLIT_OFFSET_MIN + Math.random() * (SPLIT_OFFSET_MAX - SPLIT_OFFSET_MIN);
    p.plateCX[slot]      = wrap(x + Math.cos(offAng) * offDist);
    p.plateCZ[slot]      = wrap(z + Math.sin(offAng) * offDist);
    p.plateH[slot]       = p.plateH[k];
    p.plateType[slot]    = p.plateType[k];
    p.plateHills[slot]   = p.plateHills[k];
    const pAng = Math.random() * TAU;
    const pSpd = 0.03 + Math.random() * 0.06;
    p.plateDriftVX[slot] = p.plateDriftVX[k] + Math.cos(pAng) * pSpd;
    p.plateDriftVZ[slot] = p.plateDriftVZ[k] + Math.sin(pAng) * pSpd;
    p.plateActive[slot]  = 1;
    computeWorleyFields();
    break;
  }
}

// ---------- Worley noise ----------
// For each cell, find the two closest plate centres and store their IDs,
// distances, and per-plate fields. Then assemble `targetSurface` from
// plate heights, boundary effects, and detail noise.
export function computeWorleyFields() {
  const p = plates;
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
        if (!p.plateActive[k]) continue;
        const dx = wrapRel(p.plateCX[k] - x), dz = wrapRel(p.plateCZ[k] - z);
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
      HA[idx]  = p.plateH[k1];
      HB[idx]  = p.plateH[K2[idx]];
      TA[idx]  = p.plateType[k1];
      TB[idx]  = p.plateType[K2[idx]];
      HiA[idx] = p.plateHills[k1];
      HiB[idx] = p.plateHills[K2[idx]];
    }
  }

  // Assemble targetSurface (heights + boundaries + plateaus + detail + lava bonus)
  const K1b = State.plateK1, K2b = State.plateK2;
  const TGT = State.targetSurface;
  for (let k = 0; k < N * N; k++) {
    const k1 = K1b[k], k2 = K2b[k];
    if (k1 < 0) { TGT[k] = 0; continue; }
    const tA = TA[k], tB = TB[k];
    const edge = F2[k] - F1[k];
    const wA = 0.5 + 0.5 * Math.tanh(edge / BLEND_WIDTH);
    const hA = HA[k], hB = HB[k];
    const hBlend = wA * hA + (1 - wA) * hB;

    const dx = wrapRel(p.plateCX[k2] - p.plateCX[k1]);
    const dz = wrapRel(p.plateCZ[k2] - p.plateCZ[k1]);
    const dNorm = Math.hypot(dx, dz) || 1;
    const nx = dx / dNorm, nz = dz / dNorm;
    const vRelX = p.plateDriftVX[k2] - p.plateDriftVX[k1];
    const vRelZ = p.plateDriftVZ[k2] - p.plateDriftVZ[k1];
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

    const x = (k % N) * cellSize;
    const z = ((k / N) | 0) * cellSize;
    const hillsBlend = wA * HiA[k] + (1 - wA) * HiB[k];
    const detailNoise = fbmTorus(x, z, DETAIL_OCT, DETAIL_FREQ, Globals.worldSeed + 777);
    const detail = DETAIL_AMP * (0.3 + 0.7 * hillsBlend) * detailNoise;

    TGT[k] = hBlend + boundaryHeight + plateau + detail;
  }

  // Lava is part of the permanent target — relaxation must not eat the cone.
  for (let k = 0; k < N * N; k++) {
    TGT[k] += State.lavaBonus[k];
  }
}

// Slowly drifting low-frequency noise driving volcanism / uplift.
export function computeMantleField(t) {
  const ox = Math.cos(t * MANTLE_DRIFT) * 4.0;
  const oy = Math.sin(t * MANTLE_DRIFT) * 4.0;
  for (let k = 0; k < N * N; k++) {
    const x = (k % N) * cellSize;
    const z = ((k / N) | 0) * cellSize;
    const u = (x / L) * TAU, v = (z / L) * TAU;
    const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    State.mantleField[k] = vnoise4(cu * 1.4 + ox, su * 1.4 + oy,
                                   cv * 1.4 - ox, sv * 1.4 + oy,
                                   Globals.worldSeed + 999);
  }
}

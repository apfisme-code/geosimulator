// Hydrology: terrain fill (so lakes find their spill), D8 flow routing
// with priority-flood, river accumulation, water and aquifer advection.

import { GRID, HYDROLOGY, ICE, EROSION } from './constants.js';
const { N, DIRS } = GRID;
const { FILL_EPS, K_DRAIN_ROUTING, NBUCKETS } = HYDROLOGY;
const { AQ_FLOW } = ICE;
const { K_FLOW } = EROSION;
import { State, Globals, H1, H2, H3, H4, surfaceField } from './state.js';

// ---------- Priority-flood spill levels ----------
// For every cell, the minimum water height that would make water spill
// from this cell to the ocean. Implemented with a binary min-heap.
/**
 * Push a (cell, spill-level) entry onto the priority-flood min-heap.
 * Sift-up maintains the heap invariant.
 * @param {number} idx  Cell index.
 * @param {number} lev  Spill level for that cell.
 */
function pfPush(idx, lev) {
  if (Globals.pfHeapSize >= State.pfHeapIdx.length) return;
  State.pfHeapIdx[Globals.pfHeapSize] = idx;
  State.pfHeapLev[Globals.pfHeapSize] = lev;
  let i = Globals.pfHeapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (State.pfHeapLev[p] <= State.pfHeapLev[i]) break;
    const ti = State.pfHeapIdx[p]; State.pfHeapIdx[p] = State.pfHeapIdx[i]; State.pfHeapIdx[i] = ti;
    const tl = State.pfHeapLev[p]; State.pfHeapLev[p] = State.pfHeapLev[i]; State.pfHeapLev[i] = tl;
    i = p;
  }
}
/**
 * Pop the cell with the smallest spill-level from the heap and return it.
 * Sift-down restores the invariant.
 * @returns {number} The cell index with the lowest spill-level.
 */
function pfPop() {
  const outIdx = State.pfHeapIdx[0];
  Globals.pfHeapSize--;
  if (Globals.pfHeapSize > 0) {
    State.pfHeapIdx[0] = State.pfHeapIdx[Globals.pfHeapSize];
    State.pfHeapLev[0] = State.pfHeapLev[Globals.pfHeapSize];
    let i = 0;
    while (true) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let m = i;
      if (l < Globals.pfHeapSize && State.pfHeapLev[l] < State.pfHeapLev[m]) m = l;
      if (r < Globals.pfHeapSize && State.pfHeapLev[r] < State.pfHeapLev[m]) m = r;
      if (m === i) break;
      const ti = State.pfHeapIdx[m]; State.pfHeapIdx[m] = State.pfHeapIdx[i]; State.pfHeapIdx[i] = ti;
      const tl = State.pfHeapLev[m]; State.pfHeapLev[m] = State.pfHeapLev[i]; State.pfHeapLev[i] = tl;
      i = m;
    }
  }
  return outIdx;
}

/**
 * Fill `spillLevel[]`: for every cell, the minimum water height that
 * would make water spill out of this cell and reach the ocean.
 *
 * Implemented as a priority-flood seeded from all ocean cells; expands
 * outward by always picking the lowest-so-far unseen neighbour and
 * setting its spill level to `max(parent spill, surface height)`. The
 * lake fill/drain step uses these levels to decide where water can sit.
 *
 * If there are no ocean cells at all (sea level higher than everything),
 * every cell is treated as already spilling at sea level.
 */
export function computeSpillLevels() {
  State.spillLevel.fill(1e9);
  Globals.pfHeapSize = 0;
  for (let k = 0; k < N * N; k++) {
    const surface = surfaceField[k];
    if (surface < Globals.seaLevel) {
      State.spillLevel[k] = Globals.seaLevel;
      pfPush(k, Globals.seaLevel);
    }
  }
  if (Globals.pfHeapSize === 0) {
    // No ocean at all — treat every cell as already spilling at sea level.
    for (let k = 0; k < N * N; k++) {
      State.spillLevel[k] = Globals.seaLevel;
      pfPush(k, Globals.seaLevel);
    }
  }
  while (Globals.pfHeapSize > 0) {
    const k = pfPop();
    const lev = State.spillLevel[k];
    const i = k % N, j = (k / N) | 0;
    for (let d = 0; d < 4; d++) {
      const ni = ((i + DIRS[d][0]) % N + N) % N;
      const nj = ((j + DIRS[d][1]) % N + N) % N;
      const nk = nj * N + ni;
      const surf = surfaceField[nk];
      const newLev = Math.max(lev, surf);
      if (newLev < State.spillLevel[nk]) {
        State.spillLevel[nk] = newLev;
        pfPush(nk, newLev);
      }
    }
  }
}

// ---------- D8 flow routing ----------
/**
 * Build the D8 flow-direction map and the upstream accumulation map used
 * by climate humidity and river erosion. Stages:
 *
 *   1. Iterative 1-cell depression fill into `bucketData` (4 passes max).
 *   2. For every land cell, store the lowest neighbour's DIRS index in
 *      `flowDir` (or `-1` for ocean / spill cells).
 *   3. Bucket cells by filled height into `NBUCKETS` buckets so we can
 *      accumulate flow in top-down order without sorting N² entries.
 *   4. Walk high-to-low; every cell pushes 1 unit of flow (plus any
 *      already accumulated) to its D8 sink. Ocean cells get reset to 0.
 */
export function computeFlowRouting() {
  // 1. Fill depressions (bucket data is the working copy)
  for (let k = 0; k < N * N; k++) {
    State.bucketData[k] = surfaceField[k];
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let j = 0; j < N; j++) {
      const jN = (j + 1) % N, jS = (j - 1 + N) % N;
      const rowC = j * N, rowN = jN * N, rowS = jS * N;
      for (let i = 0; i < N; i++) {
        const iE = (i + 1) % N, iW = (i - 1 + N) % N;
        const idx = rowC + i;
        const h = State.bucketData[idx];
        if (h <= Globals.seaLevel) continue;
        let minN = Infinity;
        let m;
        m = State.bucketData[rowC + iE]; if (m < minN) minN = m;
        m = State.bucketData[rowC + iW]; if (m < minN) minN = m;
        m = State.bucketData[rowN + i ]; if (m < minN) minN = m;
        m = State.bucketData[rowS + i ]; if (m < minN) minN = m;
        m = State.bucketData[rowN + iE]; if (m < minN) minN = m;
        m = State.bucketData[rowN + iW]; if (m < minN) minN = m;
        m = State.bucketData[rowS + iE]; if (m < minN) minN = m;
        m = State.bucketData[rowS + iW]; if (m < minN) minN = m;
        if (h < minN - FILL_EPS) {
          State.bucketData[idx] = minN + FILL_EPS;
          changed++;
        }
      }
    }
    if (changed === 0) break;
  }

  // 2. Pick the lowest neighbour as the flow direction (D8)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const surface = surfaceField[idx];
      if (surface < Globals.seaLevel) { State.flowDir[idx] = -1; continue; }
      const h = State.bucketData[idx];
      let bestH = h, bestDir = -1;
      for (let d = 0; d < 8; d++) {
        const ni = ((i + DIRS[d][0]) % N + N) % N;
        const nj = ((j + DIRS[d][1]) % N + N) % N;
        const nh = State.bucketData[nj * N + ni];
        if (nh < bestH) { bestH = nh; bestDir = d; }
      }
      State.flowDir[idx] = bestDir;
    }
  }

  // 3. Bucket cells by filled height for top-down accumulation.
  // Dynamic hMin/hMax from the actual filled terrain — hardcoded values
  // got exceeded by tall volcanoes + lavaBonus and crammed half the
  // world into the last bucket, breaking the top-down accumulation order.
  let hMin = Infinity, hMax = -Infinity;
  for (let k = 0; k < N * N; k++) {
    const h = State.bucketData[k];
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  State.bucketHead.fill(-1);
  const hRange = hMax - hMin || 1;
  for (let k = 0; k < N * N; k++) {
    const h = State.bucketData[k];
    let b = Math.floor((h - hMin) / hRange * NBUCKETS);
    if (b < 0) b = 0;
    if (b >= NBUCKETS) b = NBUCKETS - 1;
    State.bucketNext[k] = State.bucketHead[b];
    State.bucketHead[b] = k;
  }

  // 4. Accumulate flow from high to low (each cell gives 1 to its sink).
  State.flowAccumRouting.fill(1.0);
  for (let b = NBUCKETS - 1; b >= 0; b--) {
    for (let k = State.bucketHead[b]; k !== -1; k = State.bucketNext[k]) {
      const d = State.flowDir[k];
      if (d < 0) continue;
      const i = k % N, j = (k / N) | 0;
      const ni = ((i + DIRS[d][0]) % N + N) % N;
      const nj = ((j + DIRS[d][1]) % N + N) % N;
      const nidx = nj * N + ni;
      State.flowAccumRouting[nidx] += State.flowAccumRouting[k];
    }
  }
  for (let k = 0; k < N * N; k++) {
    const surface = surfaceField[k];
    if (surface < Globals.seaLevel) State.flowAccumRouting[k] = 0;
  }
}

// ---------- Water pair flux ----------
/**
 * Move water between two adjacent cells, biased along the D8 flow
 * direction. The caller passes the neighbour index and the DIRS offset
 * of the connection so this function can decide whether to use the full
 * weight (flow-aligned) or the much smaller cross-flow weight.
 *
 * Mutates `State.Wtmp`, `State.Sedtmp`, `State.Fmag`. Returns nothing —
 * caller is expected to copy `Wtmp` back into `W` after the full pass.
 *
 * @param {number} a          Cell A index.
 * @param {number} b          Cell B index (neighbour).
 * @param {number} dt         Simulated time step in seconds.
 * @param {number} dirFromA   DIRS index whose direction is "A → B".
 * @param {number} dirFromB   DIRS index whose direction is "B → A".
 */
export function waterPairBiased(a, b, dt, dirFromA, dirFromB) {
  const sa = surfaceField[a] + State.Wtmp[a];
  const sb = surfaceField[b] + State.Wtmp[b];
  const d = sa - sb;
  if (Math.abs(d) < 1e-6) return;

  const src = d > 0 ? a : b;
  const dst = d > 0 ? b : a;

  let weight = 0.05;
  if (d > 0) { if (State.flowDir[a] === dirFromA) weight = 1.0; }
  else       { if (State.flowDir[b] === dirFromB) weight = 1.0; }

  const availW = Math.max(0, State.Wtmp[src]);
  let q = K_FLOW * weight * Math.abs(d) * dt;
  q = Math.min(q, availW * 0.25);
  if (q <= 0) return;
  const wFrac = q / Math.max(availW, 1e-6);
  const sedFlux = Math.max(0, State.Sedtmp[src]) * Math.min(wFrac, 1);
  State.Wtmp[src] -= q;        State.Wtmp[dst] += q;
  State.Sedtmp[src] -= sedFlux; State.Sedtmp[dst] += sedFlux;
  State.Fmag[src] += q;        State.Fmag[dst] += q;
}

// ---------- Aquifer pair flux ----------
/**
 * Same shape as `waterPairBiased` but for the subsurface aquifer. The
 * bias weight is smaller — aquifers concentrate in valleys instead of
 * streaming. No sediment flux.
 *
 * @param {number} a          Cell A index.
 * @param {number} b          Cell B index (neighbour).
 * @param {number} dt         Simulated time step in seconds.
 * @param {number} dirFromA   DIRS index whose direction is "A → B".
 * @param {number} dirFromB   DIRS index whose direction is "B → A".
 */
export function aqPair(a, b, dt, dirFromA, dirFromB) {
  const hA = surfaceField[a] + State.Aqtmp[a];
  const hB = surfaceField[b] + State.Aqtmp[b];
  const d = hA - hB;
  if (Math.abs(d) < 1e-5) return;

  const src = d > 0 ? a : b;
  const dst = d > 0 ? b : a;

  let weight = 0.02;
  if (d > 0) { if (State.flowDir[a] === dirFromA) weight = 1.0; }
  else       { if (State.flowDir[b] === dirFromB) weight = 1.0; }

  const availAq = Math.max(0, State.Aqtmp[src]);
  let q = AQ_FLOW * weight * Math.abs(d) * dt;
  q = Math.min(q, availAq * 0.10);
  if (q <= 0) return;
  State.Aqtmp[src] -= q;
  State.Aqtmp[dst] += q;
}

/**
 * One sweep of surface-water advection across the whole grid. Called
 * twice per step from `stepWater` with alternating `reverse` so the
 * scheme is symmetric. Writes `Wtmp`/`Sedtmp`/`Fmag`, then copies back
 * to `W`/`Sed`.
 *
 * @param {number}  dt       Simulated time step in seconds.
 * @param {boolean} reverse  If true, sweep bottom-right → top-left.
 */
export function advectWater(dt, reverse) {
  State.Wtmp.set(State.W); State.Sedtmp.set(State.Sed); State.Fmag.fill(0);
  if (!reverse) {
    for (let j = 0; j < N; j++) {
      const jN = (j + 1) % N;
      const rowC = j * N, rowN = jN * N;
      for (let i = 0; i < N; i++) {
        const iE = (i + 1) % N, iW = (i - 1 + N) % N;
        const a = rowC + i;
        waterPairBiased(a, rowC + iE, dt, 0, 1);
        waterPairBiased(a, rowN + i,  dt, 2, 3);
        waterPairBiased(a, rowN + iE, dt, 4, 7);
        waterPairBiased(a, rowN + iW, dt, 5, 6);
      }
    }
  } else {
    for (let j = N - 1; j >= 0; j--) {
      const jS = (j - 1 + N) % N;
      const rowC = j * N, rowS = jS * N;
      for (let i = N - 1; i >= 0; i--) {
        const iW = (i - 1 + N) % N, iE = (i + 1) % N;
        const a = rowC + i;
        waterPairBiased(a, rowC + iW, dt, 1, 0);
        waterPairBiased(a, rowS + i,  dt, 3, 2);
        waterPairBiased(a, rowS + iW, dt, 7, 4);
        waterPairBiased(a, rowS + iE, dt, 6, 5);
      }
    }
  }
  State.W.set(State.Wtmp); State.Sed.set(State.Sedtmp);
}

/**
 * Same shape as `advectWater` but for the subsurface aquifer. Uses a
 * separate scratch buffer (`Aqtmp`) and doesn't carry sediment.
 *
 * @param {number}  dt       Simulated time step in seconds.
 * @param {boolean} reverse  If true, sweep bottom-right → top-left.
 */
export function advectAq(dt, reverse) {
  State.Aqtmp.set(State.Aq);
  if (!reverse) {
    for (let j = 0; j < N; j++) {
      const jN = (j + 1) % N;
      const rowC = j * N, rowN = jN * N;
      for (let i = 0; i < N; i++) {
        const iE = (i + 1) % N, iW = (i - 1 + N) % N;
        const a = rowC + i;
        aqPair(a, rowC + iE, dt, 0, 1);
        aqPair(a, rowN + i,  dt, 2, 3);
        aqPair(a, rowN + iE, dt, 4, 7);
        aqPair(a, rowN + iW, dt, 5, 6);
      }
    }
  } else {
    for (let j = N - 1; j >= 0; j--) {
      const jS = (j - 1 + N) % N;
      const rowC = j * N, rowS = jS * N;
      for (let i = N - 1; i >= 0; i--) {
        const iW = (i - 1 + N) % N, iE = (i + 1) % N;
        const a = rowC + i;
        aqPair(a, rowC + iW, dt, 1, 0);
        aqPair(a, rowS + i,  dt, 3, 2);
        aqPair(a, rowS + iW, dt, 7, 4);
        aqPair(a, rowS + iE, dt, 6, 5);
      }
    }
  }
  State.Aq.set(State.Aqtmp);
}

// Centralised simulation state.
// We expose everything as a single object so importers see live references
// and can mutate entries (Float32Array[i] = …, .set, .fill) without
// re-binding the top-level name.

import {
  N, MAX_PLATES, NBUCKETS, HIST_LEN,
  PLATE_COUNT, AQ_MAX,
} from './constants.js';

// ---------- Terrain layers (soil/gravel/soft rock/hard rock) ----------
const H1   = new Float32Array(N * N);
const H2   = new Float32Array(N * N);
const H3   = new Float32Array(N * N);
const H4   = new Float32Array(N * N);
const H1t  = new Float32Array(N * N);
const H2t  = new Float32Array(N * N);
const H3t  = new Float32Array(N * N);
const H4t  = new Float32Array(N * N);

// ---------- Water and sediment ----------
const W      = new Float32Array(N * N);
const Sed    = new Float32Array(N * N);
const Wtmp   = new Float32Array(N * N);
const Sedtmp = new Float32Array(N * N);
const Fmag   = new Float32Array(N * N);

// ---------- Aquifer ----------
const Aq     = new Float32Array(N * N);
const Aqtmp  = new Float32Array(N * N);

// ---------- Lava (drifts with plates, immune to relaxation) ----------
const lavaBonus  = new Float32Array(N * N);
const lavaBonusT = new Float32Array(N * N);

// ---------- Snow and ice ----------
const snowLayer = new Float32Array(N * N);
const iceLayer  = new Float32Array(N * N);

// ---------- Wind ----------
const windSed  = new Float32Array(N * N);
const windSedB = new Float32Array(N * N);

// ---------- Volcanoes ----------
const eruptHeat = new Float32Array(N * N);
const ashLayer  = new Float32Array(N * N);

// ---------- Hydrology routing ----------
const flowDir          = new Int8Array(N * N);
const flowAccumRouting = new Float32Array(N * N);
const spillLevel       = new Float32Array(N * N);
const bucketHead       = new Int32Array(NBUCKETS);
const bucketNext       = new Int32Array(N * N);
const bucketData       = new Float32Array(N * N);

// ---------- Spill flood-fill heap ----------
const pfHeapIdx = new Int32Array(N * N * 4);
const pfHeapLev = new Float32Array(N * N * 4);

// ---------- Climate ----------
const temperature = new Float32Array(N * N);
const humidity    = new Float32Array(N * N);
const humDist     = new Float32Array(N * N);
const rainShadow  = new Float32Array(N * N);
const currentT    = new Float32Array(N * N);
const bfsQueue    = new Int32Array(N * N);

// ---------- Mantle / plates ----------
const mantleField = new Float32Array(N * N);

// Per-plate state — initialised straight away so consumers can read
// them through State.plateCX / State.plateDriftVX / … without an
// extra lazy-allocation step.
const plateCX       = new Float32Array(MAX_PLATES);
const plateCZ       = new Float32Array(MAX_PLATES);
const plateH        = new Float32Array(MAX_PLATES);
const plateType     = new Int8Array(MAX_PLATES);
const plateHills    = new Float32Array(MAX_PLATES);
const plateDriftVX  = new Float32Array(MAX_PLATES);
const plateDriftVZ  = new Float32Array(MAX_PLATES);
const plateActive   = new Uint8Array(MAX_PLATES);
const plateArea     = new Int32Array(MAX_PLATES);
const plateF1       = new Float32Array(N * N);
const plateF2       = new Float32Array(N * N);
const plateK1       = new Int16Array(N * N);
const plateK2       = new Int16Array(N * N);
const plateH_A      = new Float32Array(N * N);
const plateH_B      = new Float32Array(N * N);
const plateTypeA    = new Int8Array(N * N);
const plateTypeB    = new Int8Array(N * N);
const plateHillsA   = new Float32Array(N * N);
const plateHillsB   = new Float32Array(N * N);
const targetSurface = new Float32Array(N * N);

// ---------- History rings ----------
const histLand   = new Float32Array(HIST_LEN);
const histSnow   = new Float32Array(HIST_LEN);
const histIce    = new Float32Array(HIST_LEN);
const histSea    = new Float32Array(HIST_LEN);
const histPlates = new Float32Array(HIST_LEN);
const histAq     = new Float32Array(HIST_LEN);

// ---------- Plates accessor (kept for backwards-compat — no-op now) ----------
export function allocatePlateArrays() {
  return {
    plateCX, plateCZ, plateH, plateType, plateHills,
    plateDriftVX, plateDriftVZ, plateActive, plateArea,
  };
}

// Public state object — everything is mutable in place.
export const State = {
  // terrain
  H1, H2, H3, H4, H1t, H2t, H3t, H4t,
  // water
  W, Sed, Wtmp, Sedtmp, Fmag,
  // aquifer
  Aq, Aqtmp,
  // lava
  lavaBonus, lavaBonusT,
  // snow/ice
  snowLayer, iceLayer,
  // wind
  windSed, windSedB,
  // volcanoes
  eruptHeat, ashLayer,
  // hydro
  flowDir, flowAccumRouting, spillLevel,
  bucketHead, bucketNext, bucketData,
  // spill heap
  pfHeapIdx, pfHeapLev,
  // climate
  temperature, humidity, humDist, rainShadow, currentT, bfsQueue,
  // mantle/plates
  mantleField,
  plateCX, plateCZ, plateH, plateType, plateHills,
  plateDriftVX, plateDriftVZ, plateActive, plateArea,
  plateF1, plateF2, plateK1, plateK2,
  plateH_A, plateH_B, plateTypeA, plateTypeB,
  plateHillsA, plateHillsB,
  targetSurface,
  // history
  histLand, histSnow, histIce, histSea, histPlates, histAq,
};

// ---------- Mutable globals (flags, counters, RNG state) ----------
export const Globals = {
  worldSeed: (Math.random() * 0x7fffffff) | 0,
  seaLevel: 0,
  tRef: 0.5,
  plumes: [],
  volcanoesEnabled: true,
  overlayMode: 0,
  showSlice: false,
  showGraphs: false,
  simTime: 0,
  simStepCount: 0,
  simClampViolations: 0,
  rainEnabled: true,
  windEnabled: true,
  iceEnabled:  true,
  birthsTotal: 0,
  deathsTotal: 0,
  routingRuns: 0,
  advectRuns: 0,
  climateRuns: 0,
  eruptionsTotal: 0,
  pfHeapSize: 0,
  lastEruption: { i: -1, j: -1, t: -1e9, underwater: false },
  player: { x: 0, z: 0, yaw: 0, pitch: 0, vy: 0, onGround: true },
  feetY: 0,
  paused: false,
  histHead: 0,
  histCount: 0,
  stats: new Array(16).fill(0),
};

// Quick resetters used by resetTerrain()
export function resetCounters() {
  Globals.simTime = 0;
  Globals.simStepCount = 0;
  Globals.simClampViolations = 0;
  Globals.birthsTotal = 0;
  Globals.deathsTotal = 0;
  Globals.routingRuns = 0;
  Globals.advectRuns = 0;
  Globals.climateRuns = 0;
  Globals.eruptionsTotal = 0;
  Globals.histHead = 0;
  Globals.histCount = 0;
  Globals.lastEruption = { i: -1, j: -1, t: -1e9, underwater: false };
}

// Export pieces used in many places
export { AQ_MAX, PLATE_COUNT };

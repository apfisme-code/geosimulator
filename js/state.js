// Centralised simulation state.
// We expose everything as a single object so importers see live references
// and can mutate entries (Float32Array[i] = …, .set, .fill) without
// re-binding the top-level name.
//
// `State` holds every Float32Array/Int32Array the simulation owns — the
// terrain stack, water/sediment, snow/ice, climate maps, routing maps,
// plate state, and history rings. `Globals` holds the scalar/flag fields
// (sea level, sim time, counters, settings, player pose). Both are also
// re-exported as top-level names for hot loops that don't want to go
// through `State.X` every time.

import { GRID, HYDROLOGY, OVERLAY, ICE, PLATES } from './constants.js';
const { N } = GRID;
const { NBUCKETS } = HYDROLOGY;
const { HIST_LEN } = OVERLAY;
const { AQ_MAX } = ICE;
const { MAX: MAX_PLATES } = PLATES;

// ---------- Terrain layers (soil/gravel/soft rock/hard rock) ----------
/** @type {Float32Array} Soil (H1) — soft top layer, can hold moisture. */
const H1   = new Float32Array(N * N);
/** @type {Float32Array} Gravel (H2) — medium-soft compacted sediment. */
const H2   = new Float32Array(N * N);
/** @type {Float32Array} Soft rock (H3) — weathered bedrock. */
const H3   = new Float32Array(N * N);
/** @type {Float32Array} Hard rock (H4) — ancient basement. */
const H4   = new Float32Array(N * N);
/** @type {Float32Array} Scratch copy of H1 used by talus sliding. */
const H1t  = new Float32Array(N * N);
/** @type {Float32Array} Scratch copy of H2 used by talus sliding. */
const H2t  = new Float32Array(N * N);
/** @type {Float32Array} Scratch copy of H3 used by talus sliding. */
const H3t  = new Float32Array(N * N);
/** @type {Float32Array} Scratch copy of H4 used by talus sliding. */
const H4t  = new Float32Array(N * N);
// Cached sum of the four layers — recomputed only when the height stack
// changes (resetTerrain, after stepErosion). Hot loops read this instead
// of doing four indexed adds per cell per pass.
/** @type {Float32Array} H1+H2+H3+H4 — the visible surface height. */
const surfaceField = new Float32Array(N * N);

/**
 * Recompute surfaceField after any step that mutates H1..H4 in place.
 * O(N²) = 16384 adds — cheap relative to the steps that need it.
 * Must be called by resetTerrain(), after stepErosion() (which mutates
 * H1..H4 in place via riverErosion), and by any step that wants the
 * cached value to match reality.
 */
export function recomputeSurface() {
  for (let k = 0; k < N * N; k++) {
    surfaceField[k] = H1[k] + H2[k] + H3[k] + H4[k];
  }
}

// ---------- Water and sediment ----------
/** @type {Float32Array} Surface water depth on top of the height column. */
const W      = new Float32Array(N * N);
/** @type {Float32Array} Suspended sediment carried by water (flux). */
const Sed    = new Float32Array(N * N);
/** @type {Float32Array} Scratch buffer for water advection. */
const Wtmp   = new Float32Array(N * N);
/** @type {Float32Array} Scratch buffer for sediment advection. */
const Sedtmp = new Float32Array(N * N);
/** @type {Float32Array} Magnitude of the water flux through each cell. */
const Fmag   = new Float32Array(N * N);

// ---------- Aquifer ----------
/** @type {Float32Array} Subsurface water (aquifer) level. */
const Aq     = new Float32Array(N * N);
/** @type {Float32Array} Scratch buffer for aquifer advection. */
const Aqtmp  = new Float32Array(N * N);

// ---------- Lava (drifts with plates, immune to relaxation) ----------
/** @type {Float32Array} Permanent volcanic cone thickness added to H4. */
const lavaBonus  = new Float32Array(N * N);
/** @type {Float32Array} Scratch buffer for lava drift advection. */
const lavaBonusT = new Float32Array(N * N);

// ---------- Snow and ice ----------
/** @type {Float32Array} Snow layer thickness on top of land/ice. */
const snowLayer = new Float32Array(N * N);
/** @type {Float32Array} Sea/lake ice thickness (freeboards land/sea). */
const iceLayer  = new Float32Array(N * N);

// ---------- Wind ----------
/** @type {Float32Array} Suspended wind-blown sediment in flight. */
const windSed  = new Float32Array(N * N);
/** @type {Float32Array} Scratch buffer for wind advection. */
const windSedB = new Float32Array(N * N);

// ---------- Volcanoes ----------
/** @type {Float32Array} Residual heat from recent eruptions (drives temperature). */
const eruptHeat = new Float32Array(N * N);
/** @type {Float32Array} Recent ash deposits (H1-mixed). */
const ashLayer  = new Float32Array(N * N);

// ---------- Hydrology routing ----------
/** @type {Int8Array} D8 flow direction index (0..7) for each land cell; -1 for ocean. */
const flowDir          = new Int8Array(N * N);
/** @type {Float32Array} Accumulated upstream cell count per cell. */
const flowAccumRouting = new Float32Array(N * N);
/** @type {Float32Array} Minimum water height that would spill out of this cell. */
const spillLevel       = new Float32Array(N * N);
/** @type {Int32Array} Bucket-sort head pointer per height bucket. */
const bucketHead       = new Int32Array(NBUCKETS);
/** @type {Int32Array} Bucket-sort next-cell linked list. */
const bucketNext       = new Int32Array(N * N);
/** @type {Float32Array} Depression-filled working copy of the surface. */
const bucketData       = new Float32Array(N * N);

// ---------- Spill flood-fill heap ----------
/** @type {Int32Array} Cell-index entries in the priority-flood min-heap. */
const pfHeapIdx = new Int32Array(N * N * 4);
/** @type {Float32Array} Spill-level entries in the priority-flood min-heap. */
const pfHeapLev = new Float32Array(N * N * 4);

// ---------- Climate ----------
/** @type {Float32Array} Normalised temperature (0=freezing, 1=hot). */
const temperature = new Float32Array(N * N);
/** @type {Float32Array} Normalised humidity (0=dry, 1=saturated). */
const humidity    = new Float32Array(N * N);
/** @type {Float32Array} BFS distance from the nearest water/ice edge. */
const humDist     = new Float32Array(N * N);
/** @type {Float32Array} Rain-shadow factor in [0,1] (1=no shadow). */
const rainShadow  = new Float32Array(N * N);
/** @type {Float32Array} Local ocean current temperature offset. */
const currentT    = new Float32Array(N * N);
/** @type {Int32Array} Reusable BFS queue for humidity distance. */
const bfsQueue    = new Int32Array(N * N);

// ---------- Mantle / plates ----------
/** @type {Float32Array} Slowly-drifting low-frequency noise driving uplift. */
const mantleField = new Float32Array(N * N);

// Per-plate state — initialised straight away so consumers can read
// them through State.plateCX / State.plateDriftVX / … without an
// extra lazy-allocation step.
/** @type {Float32Array} Plate centre X (world units). */
const plateCX       = new Float32Array(MAX_PLATES);
/** @type {Float32Array} Plate centre Z (world units). */
const plateCZ       = new Float32Array(MAX_PLATES);
/** @type {Float32Array} Target base elevation for cells owned by it. */
const plateH        = new Float32Array(MAX_PLATES);
/** @type {Int8Array} 0=oceanic, 1=continental. */
const plateType     = new Int8Array(MAX_PLATES);
/** @type {Float32Array} Hilliness bias in [0,1]. */
const plateHills    = new Float32Array(MAX_PLATES);
/** @type {Float32Array} Plate drift velocity (world units / sec). */
const plateDriftVX  = new Float32Array(MAX_PLATES);
/** @type {Float32Array} Plate drift velocity (world units / sec). */
const plateDriftVZ  = new Float32Array(MAX_PLATES);
/** @type {Uint8Array} 1=active, 0=inactive (deactivated / unused slot). */
const plateActive   = new Uint8Array(MAX_PLATES);
/** @type {Int32Array} Area in cells (kept for diagnostics, not the CSR scan path). */
const plateArea     = new Int32Array(MAX_PLATES);
/** @type {Float32Array} Distance from cell to its nearest plate centre (K1). */
const plateF1       = new Float32Array(N * N);
/** @type {Float32Array} Distance from cell to its second-nearest plate centre (K2). */
const plateF2       = new Float32Array(N * N);
/** @type {Int16Array} Index of the nearest plate centre for each cell. */
const plateK1       = new Int16Array(N * N);
/** @type {Int16Array} Index of the second-nearest plate centre for each cell. */
const plateK2       = new Int16Array(N * N);
// Per-plate cell lists (CSR layout): for each k, plateCellsStart[k] is
// the start index inside plateCellsIdx, plateCellsCount[k] is the length.
// Lets updatePlateLifecycle scan only the cells that actually belong to
// plate k instead of all N² cells.
/** @type {Int32Array} Start offset into plateCellsIdx for plate k's cells. */
const plateCellsStart = new Int32Array(MAX_PLATES);
/** @type {Int32Array} Number of cells owned by plate k. */
const plateCellsCount = new Int32Array(MAX_PLATES);
/** @type {Int32Array} Flat array of cell indices, CSR-packed by plate. */
const plateCellsIdx   = new Int32Array(N * N);
/** @type {Float32Array} Plate-target base height for the K1 plate. */
const plateH_A      = new Float32Array(N * N);
/** @type {Float32Array} Plate-target base height for the K2 plate. */
const plateH_B      = new Float32Array(N * N);
/** @type {Int8Array} Plate-type copy for the K1 plate. */
const plateTypeA    = new Int8Array(N * N);
/** @type {Int8Array} Plate-type copy for the K2 plate. */
const plateTypeB    = new Int8Array(N * N);
/** @type {Float32Array} Hilliness copy for the K1 plate. */
const plateHillsA   = new Float32Array(N * N);
/** @type {Float32Array} Hilliness copy for the K2 plate. */
const plateHillsB   = new Float32Array(N * N);
/** @type {Float32Array} Assembled target surface height per cell. */
const targetSurface = new Float32Array(N * N);

// ---------- History rings ----------
/** @type {Float32Array} Ring buffer: % of land cells. */
const histLand   = new Float32Array(HIST_LEN);
/** @type {Float32Array} Ring buffer: % of cells with snow. */
const histSnow   = new Float32Array(HIST_LEN);
/** @type {Float32Array} Ring buffer: % of cells with ice. */
const histIce    = new Float32Array(HIST_LEN);
/** @type {Float32Array} Ring buffer: sea level over time. */
const histSea    = new Float32Array(HIST_LEN);
/** @type {Float32Array} Ring buffer: active plate count over time. */
const histPlates = new Float32Array(HIST_LEN);
/** @type {Float32Array} Ring buffer: average aquifer depth over land. */
const histAq     = new Float32Array(HIST_LEN);

// ---------- Public state object — everything is mutable in place. ----------
// Consumers can either read through `State.X` for grouped access or pull
// individual arrays via the named exports at the bottom of this file
// (those exist so hot loops don't have to write `State.H1` everywhere).
/**
 * Aggregate of every per-cell / per-plate typed-array field owned by the
 * simulation. Everything is mutable in place; consumers never re-bind the
 * top-level name. Layout (in declaration order):
 *
 * - Terrain:        H1, H2, H3, H4 (soils/rocks) + H1t..H4t scratch copies + surfaceField
 * - Surface water:  W, Sed, Wtmp, Sedtmp, Fmag
 * - Aquifer:        Aq, Aqtmp
 * - Volcanism:      lavaBonus, lavaBonusT
 * - Snow/ice:       snowLayer, iceLayer
 * - Wind:           windSed, windSedB
 * - Volcanoes:      eruptHeat, ashLayer
 * - Routing:        flowDir, flowAccumRouting, spillLevel, bucketHead/Next/Data
 * - Spill heap:     pfHeapIdx, pfHeapLev
 * - Climate:        temperature, humidity, humDist, rainShadow, currentT, bfsQueue
 * - Tectonics:      mantleField, plateCX/CZ/H/Type/Hills, plateDriftVX/VZ, plateActive/Area,
 *                   plateF1/F2/K1/K2, plateCellsStart/Count/Idx,
 *                   plateH_A/B, plateTypeA/B, plateHillsA/B, targetSurface
 * - History:        histLand/Snow/Ice/Sea/Plates/Aq
 *
 * @type {{
 *   H1:Float32Array, H2:Float32Array, H3:Float32Array, H4:Float32Array,
 *   H1t:Float32Array, H2t:Float32Array, H3t:Float32Array, H4t:Float32Array,
 *   surfaceField:Float32Array,
 *   W:Float32Array, Sed:Float32Array, Wtmp:Float32Array, Sedtmp:Float32Array, Fmag:Float32Array,
 *   Aq:Float32Array, Aqtmp:Float32Array,
 *   lavaBonus:Float32Array, lavaBonusT:Float32Array,
 *   snowLayer:Float32Array, iceLayer:Float32Array,
 *   windSed:Float32Array, windSedB:Float32Array,
 *   eruptHeat:Float32Array, ashLayer:Float32Array,
 *   flowDir:Int8Array, flowAccumRouting:Float32Array, spillLevel:Float32Array,
 *   bucketHead:Int32Array, bucketNext:Int32Array, bucketData:Float32Array,
 *   pfHeapIdx:Int32Array, pfHeapLev:Float32Array,
 *   temperature:Float32Array, humidity:Float32Array, humDist:Float32Array,
 *   rainShadow:Float32Array, currentT:Float32Array, bfsQueue:Int32Array,
 *   mantleField:Float32Array,
 *   plateCX:Float32Array, plateCZ:Float32Array, plateH:Float32Array, plateType:Int8Array,
 *   plateHills:Float32Array, plateDriftVX:Float32Array, plateDriftVZ:Float32Array,
 *   plateActive:Uint8Array, plateArea:Int32Array,
 *   plateF1:Float32Array, plateF2:Float32Array, plateK1:Int16Array, plateK2:Int16Array,
 *   plateCellsStart:Int32Array, plateCellsCount:Int32Array, plateCellsIdx:Int32Array,
 *   plateH_A:Float32Array, plateH_B:Float32Array,
 *   plateTypeA:Int8Array, plateTypeB:Int8Array,
 *   plateHillsA:Float32Array, plateHillsB:Float32Array,
 *   targetSurface:Float32Array,
 *   histLand:Float32Array, histSnow:Float32Array, histIce:Float32Array,
 *   histSea:Float32Array, histPlates:Float32Array, histAq:Float32Array
 * }}
 */
export const State = {
  // terrain
  H1, H2, H3, H4, H1t, H2t, H3t, H4t, surfaceField,
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
  plateCellsStart, plateCellsCount, plateCellsIdx,
  plateH_A, plateH_B, plateTypeA, plateTypeB,
  plateHillsA, plateHillsB,
  targetSurface,
  // history
  histLand, histSnow, histIce, histSea, histPlates, histAq,
};

// Named exports for the fields used in hot loops — avoids the
// `const H1 = State.H1` boilerplate in every consuming module.
export {
  H1, H2, H3, H4, H1t, H2t, H3t, H4t, surfaceField,
  W, Sed, Wtmp, Sedtmp, Fmag,
  Aq, Aqtmp,
  lavaBonus, lavaBonusT,
  snowLayer, iceLayer,
  windSed, windSedB,
  eruptHeat, ashLayer,
  flowDir, flowAccumRouting, spillLevel,
  bucketHead, bucketNext, bucketData,
  pfHeapIdx, pfHeapLev,
  temperature, humidity, humDist, rainShadow, currentT, bfsQueue,
  mantleField,
  plateCX, plateCZ, plateH, plateType, plateHills,
  plateDriftVX, plateDriftVZ, plateActive, plateArea,
  plateF1, plateF2, plateK1, plateK2,
  plateH_A, plateH_B, plateTypeA, plateTypeB,
  plateHillsA, plateHillsB,
  targetSurface,
  histLand, histSnow, histIce, histSea, histPlates, histAq,
};

// ---------- Mutable globals (flags, counters, RNG state) ----------
/**
 * Scalar simulation state — every flag, counter, RNG seed, and small
 * mutable scalar the simulation owns. Mirrors the `State` shape but
 * holds singletons rather than typed arrays.
 *
 * Notable fields:
 * - `worldSeed`       — integer seed used by all noise/initialisation.
 * - `seaLevel`        — current global sea level (driven by climate).
 * - `tRef`            — slow-moving average temperature, baseline for anomaly.
 * - `plumes`          — array of active volcano plume descriptors.
 * - `simTime`         — accumulated simulated seconds since reset.
 * - `simStepCount`    — number of `simulate()` calls since reset.
 * - `simClampViolations` — total NaN/negative-clamp events seen.
 * - `pfHeapSize`      — current size of the priority-flood min-heap.
 * - `lastEruption`    — `{i, j, t, underwater}` of the most recent eruption.
 * - `player`          — pose / velocity object: `{x, z, yaw, pitch, vy, onGround}`.
 * - `feetY`           — current vertical position of the player's feet.
 * - `histHead`        — write head of the history ring buffers.
 * - `histCount`       — number of valid entries currently in the rings.
 * - `stats`           — 16-slot pre-computed summary used by the HUD.
 * - Toggleable subsystems: `volcanoesEnabled`, `rainEnabled`, `windEnabled`, `iceEnabled`.
 * - UI toggles: `overlayMode` (0..8), `showSlice`, `showGraphs`, `paused`.
 * - Plate lifecycle: `birthsTotal`, `deathsTotal` (cumulative).
 * - Pipeline counters: `routingRuns`, `advectRuns`, `climateRuns`, `eruptionsTotal`.
 *
 * @type {{
 *   worldSeed:number, seaLevel:number, tRef:number,
 *   plumes:Array<{i:number, j:number, k:number, nextErupt:number}>,
 *   volcanoesEnabled:boolean, overlayMode:number, showSlice:boolean, showGraphs:boolean,
 *   simTime:number, simStepCount:number, simClampViolations:number,
 *   rainEnabled:boolean, windEnabled:boolean, iceEnabled:boolean,
 *   birthsTotal:number, deathsTotal:number,
 *   routingRuns:number, advectRuns:number, climateRuns:number, eruptionsTotal:number,
 *   pfHeapSize:number,
 *   lastEruption:{i:number, j:number, t:number, underwater:boolean},
 *   player:{x:number, z:number, yaw:number, pitch:number, vy:number, onGround:boolean},
 *   feetY:number, paused:boolean,
 *   histHead:number, histCount:number, stats:number[]
 * }}
 */
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

/**
 * Zero out the counters that should restart on `resetTerrain()` while
 * leaving toggles (`rainEnabled` / `windEnabled` / `iceEnabled` / …),
 * player pose, and overlay settings alone. Called by `resetTerrain`
 * after the world itself has been re-initialised.
 */
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

// Re-export pieces used in many places
export { AQ_MAX };

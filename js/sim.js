// Simulation orchestrator.
//
// simulate(dt) iterates the STEPS array top-to-bottom, skipping steps whose
// `every` interval doesn't divide the current sim step. The pipeline is
// intentionally a flat, readable list — adding/removing/reordering a step
// is a one-line change.
//
// Each step is a small named function below; STEPS only references them.

import { GRID, SIM, ICE, PLATES } from './constants.js';
const { N, L } = GRID;
const { DRIFT_INTERVAL, ADVECT_INTERVAL, FLOW_ROUTING_INTERVAL,
        CLIMATE_INTERVAL, AQ_FLOW_INTERVAL } = SIM;
const { AQ_MAX } = ICE;
const { RELAX_K, MANTLE_RATE, BLEND_WIDTH } = PLATES;
import { State, Globals, resetCounters, H1, H2, H3, H4 } from './state.js';
import { bilinearWrap } from './utils.js';
import {
  initPlates, computeWorleyFields, driftPlates,
  updatePlateLifecycle, computeMantleField, countActivePlates,
} from './plates.js';
import { computeClimate, updateSeaLevel } from './climate.js';
import {
  computeFlowRouting, computeSpillLevels,
  advectWater, advectAq,
} from './hydrology.js';
import { applyTalus, riverErosion, evaporate, applyLakes } from './erosion.js';
import { lithify, initSoil, initGravel, initSoftRock, clampSafety } from './surface.js';
import { initPlumes, tickVolcanoes } from './volcano.js';
import { windAdvect, windErodeDeposit, dropWindSed } from './wind.js';
import { glacierStep } from './ice.js';

// =====================================================================
// STEPS — each step is a function with signature (dt, t, stepCount).
// =====================================================================

// --- Tectonics (slow) ---
function stepDrift(dt, t /*, c */) {
  driftPlates(DRIFT_INTERVAL * dt);
  computeWorleyFields();
  computeMantleField(t);
  const before = countActivePlates();
  updatePlateLifecycle();
  const after = countActivePlates();
  if      (after > before) Globals.birthsTotal += (after - before);
  else if (after < before) Globals.deathsTotal += (before - after);
}
function stepAdvect(dt /*, t, c */) {
  advectLayers(ADVECT_INTERVAL * dt);
  Globals.advectRuns++;
  if (!isFinite(H1[0] + H2[0] + H3[0] + H4[0])) {
    throw new Error(`stepAdvect produced NaN at k=0 — H1=${H1[0]} H2=${H2[0]} H3=${H3[0]} H4=${H4[0]} c=${Globals.simStepCount}`);
  }
}
// Advection of layer heights along plate drift.
function advectLayers(dtAdv) {
  const inv = dtAdv / L * N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const k1 = State.plateK1[idx];
      if (k1 < 0) continue;
      const k2 = State.plateK2[idx];
      const edge = State.plateF2[idx] - State.plateF1[idx];
      const wA = 0.5 + 0.5 * Math.tanh(edge / BLEND_WIDTH);
      const vx = wA * State.plateDriftVX[k1] + (1 - wA) * State.plateDriftVX[k2];
      const vz = wA * State.plateDriftVZ[k1] + (1 - wA) * State.plateDriftVZ[k2];
      const sx = i - vx * inv;
      const sz = j - vz * inv;
      State.H1t[idx] = bilinearWrap(H1, sx, sz);
      State.H2t[idx] = bilinearWrap(H2, sx, sz);
      State.H3t[idx] = bilinearWrap(H3, sx, sz);
      State.H4t[idx] = bilinearWrap(H4, sx, sz);
      // Lava drifts with the plate so cones survive drift over oceans.
      State.lavaBonusT[idx] = bilinearWrap(State.lavaBonus, sx, sz);
    }
  }
  H1.set(State.H1t); H2.set(State.H2t); H3.set(State.H3t); H4.set(State.H4t);
  State.lavaBonus.set(State.lavaBonusT);
}
function stepRouting(/* dt, t, c */) {
  computeFlowRouting();
  computeSpillLevels();
  Globals.routingRuns++;
}
function stepClimate(dt, t /*, c */) {
  // Diagnostics: catch the moment a height field first goes NaN.
  if (!isFinite(H1[0] + H2[0] + H3[0] + H4[0])) {
    throw new Error(`stepClimate precondition: H1+H2+H3+H4 NaN at k=0 — H1=${H1[0]} H2=${H2[0]} H3=${H3[0]} H4=${H4[0]} t=${t} c=${Globals.simStepCount}`);
  }
  computeClimate(t);
  updateSeaLevel();
  Globals.climateRuns++;
}

// --- Surface processes (every tick) ---
function stepVolcanoes(/* dt, t, c */) { tickVolcanoes(); }

function stepRelax(dt, t /*, c */) {
  const pulse = 0.7 + 0.3 * Math.sin(t * 0.11);
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    const target  = State.targetSurface[k];
    const m = State.mantleField[k];
    H4[k] += RELAX_K * (target - surface) * pulse * dt;
    H4[k] += MANTLE_RATE * m * dt;
  }
}

function stepTalus(dt /*, t, c */) { applyTalus(dt); }
function stepLithify(dt /*, t, c */) { lithify(dt); }

function stepIce(dt, t /*, c */) {
  if (Globals.iceEnabled) glacierStep(dt, t);
}

function stepWind(dt, t /*, c */) {
  if (Globals.windEnabled) { windAdvect(dt); windErodeDeposit(dt, t); }
  else dropWindSed();
}

// --- Hydrology cycle (every tick) ---
function stepRain(dt, t /*, c */) {
  if (!Globals.rainEnabled) return;
  for (let j = 0; j < N; j++) {
    const v = (j / N) * Math.PI * 2, jN = j * N;
    for (let i = 0; i < N; i++) {
      const u = (i / N) * Math.PI * 2, idx = jN + i;
      const cloud = 0.5
        + 0.35 * Math.sin(2 * u + t * 0.06) * Math.cos(3 * v - t * 0.04)
        + 0.15 * Math.sin(5 * u - 2 * v + t * 0.10);
      const regional = 0.3 + 0.7 * State.humidity[idx];
      const rate = (0.010 + 0.012 * Math.max(0, cloud - 0.2)) * regional;
      const surface = H1[idx] + H2[idx] + H3[idx] + H4[idx];
      if (surface >= Globals.seaLevel) {
        State.W[idx]  += rate * dt * 0.7;
        State.Aq[idx] = Math.min(AQ_MAX, State.Aq[idx] + rate * dt * 0.3);
      } else {
        State.W[idx] += rate * dt;
      }
    }
  }
}

function stepInfiltrate(dt /*, t, c */) {
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    const isUnderwater = surface < Globals.seaLevel;
    if (!isUnderwater && State.W[k] > 0.0005 && State.Aq[k] < AQ_MAX) {
      const infil = Math.min(State.W[k] * 0.5, 0.15 * State.W[k] * dt);
      State.W[k] -= infil;
      State.Aq[k] = Math.min(AQ_MAX, State.Aq[k] + infil);
    }
    if (State.Aq[k] > 0) {
      const baseflow = 0.008 * State.Aq[k] * dt;
      State.Aq[k] -= baseflow;
      State.W[k]  += baseflow;
    }
  }
}

function stepWater(dt, t, c) { advectWater(dt, (c & 1) === 1); }

function stepAq(dt, t, c) {
  const aqDt = dt * AQ_FLOW_INTERVAL;
  advectAq(aqDt, (c & 1) === 1);
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    if (surface < Globals.seaLevel) State.Aq[k] = 0;
    if (State.Aq[k] < 0)        State.Aq[k] = 0;
    if (State.Aq[k] > AQ_MAX)   State.Aq[k] = AQ_MAX;
  }
}

function stepErosion(dt /*, t, c */) { riverErosion(dt); }
function stepEvap(dt /*, t, c */)    { evaporate(dt); }
function stepLakes(dt /*, t, c */)   { applyLakes(dt); }
function stepClamp(/* dt, t, c */)    { clampSafety(); }

// =====================================================================
// Pipeline
// =====================================================================
//   every: null   → run every tick
//   every: N      → run when (stepCount % N) === 0
// Order matters: drift must precede routing (which uses plate fields),
// climate must follow routing (which writes flowAccumRouting that climate
// reads for humidity), water advection must follow rain, and clamp
// must run last.

const STEPS = [
  // slow / interval-driven
  { name: 'drift',    every: DRIFT_INTERVAL,        fn: stepDrift   },
  { name: 'advect',   every: ADVECT_INTERVAL,       fn: stepAdvect  },
  { name: 'routing',  every: FLOW_ROUTING_INTERVAL, fn: stepRouting },
  { name: 'climate',  every: CLIMATE_INTERVAL,      fn: stepClimate },

  // every tick
  { name: 'volcanoes', every: null, fn: stepVolcanoes },
  { name: 'relax',     every: null, fn: stepRelax    },
  { name: 'talus',     every: null, fn: stepTalus    },
  { name: 'lithify',   every: null, fn: stepLithify  },
  { name: 'ice',       every: null, fn: stepIce      },
  { name: 'wind',      every: null, fn: stepWind     },
  { name: 'rain',      every: null, fn: stepRain     },
  { name: 'infiltr',   every: null, fn: stepInfiltrate },
  { name: 'water',     every: null, fn: stepWater    },
  { name: 'aq',        every: AQ_FLOW_INTERVAL,     fn: stepAq },
  { name: 'erosion',   every: null, fn: stepErosion  },
  { name: 'evap',      every: null, fn: stepEvap     },
  { name: 'lakes',     every: null, fn: stepLakes    },
  { name: 'clamp',     every: null, fn: stepClamp    },
];

// =====================================================================
// Public API
// =====================================================================

export function simulate(dt) {
  if (!isFinite(dt)) throw new Error(`simulate: dt is ${dt}`);
  Globals.simTime += dt;
  Globals.simStepCount++;
  if (!isFinite(Globals.simTime)) throw new Error(`simulate: simTime became NaN at step ${Globals.simStepCount}`);
  const t = Globals.simTime;
  const c = Globals.simStepCount;
  for (const step of STEPS) {
    if (step.every !== null && (c % step.every) !== 0) continue;
    step.fn(dt, t, c);
    // Cheap sanity: if seaLevel ever goes NaN, fail loud with the offending step.
    if (!isFinite(Globals.seaLevel)) {
      throw new Error(`simulate: seaLevel became NaN inside step "${step.name}" at simStep ${c}`);
    }
  }
}

// Expose a couple of internal probes for the browser console.
window.__sim = {
  get surfaceAtPlayer() {
    const pi = Math.floor(Globals.player.x / cellSize) % N;
    const pj = Math.floor(Globals.player.z / cellSize) % N;
    const k = pj * N + pi;
    return {
      idx: k,
      H1: H1[k], H2: H2[k], H3: H3[k], H4: H4[k],
      surface: H1[k] + H2[k] + H3[k] + H4[k],
      target: State.targetSurface[k],
      mantle: State.mantleField[k],
    };
  },
};

// ---------- World reset ----------
export function resetTerrain(regen) {
  if (regen) Globals.worldSeed = (Math.random() * 0x7fffffff) | 0;
  Globals.seaLevel = 0;
  Globals.tRef = 0.5;

  initPlates();
  computeWorleyFields();
  computeMantleField(0);

  for (let k = 0; k < N * N; k++) {
    H3[k] = initSoftRock(k);
    H2[k] = initGravel(k);
    H1[k] = initSoil(k);
    State.snowLayer[k] = 0;
    State.iceLayer[k]  = 0;
    State.Aq[k] = 0;
    State.Aqtmp[k] = 0;
    State.lavaBonus[k] = 0;
    State.lavaBonusT[k] = 0;
    if (k === 0) {
      if (!isFinite(H1[0]) || !isFinite(H2[0]) || !isFinite(H3[0])) {
        throw new Error(`resetTerrain: init produced NaN at k=0 — H1=${H1[0]} H2=${H2[0]} H3=${H3[0]}; targetSurface[0]=${State.targetSurface[0]}; worldSeed=${Globals.worldSeed}`);
      }
    }
  }
  for (let k = 0; k < N * N; k++) {
    const H123 = H1[k] + H2[k] + H3[k];
    H4[k] = State.targetSurface[k] - H123;
  }
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    State.W[k] = surface < Globals.seaLevel ? (Globals.seaLevel - surface) : 0;
  }
  State.Sed.fill(0); State.Fmag.fill(0);
  State.windSed.fill(0); State.windSedB.fill(0);
  State.eruptHeat.fill(0);
  State.ashLayer.fill(0);
  State.flowDir.fill(-1);
  State.flowAccumRouting.fill(1);
  State.spillLevel.fill(0);
  computeFlowRouting();
  computeSpillLevels();
  computeClimate(0);

  {
    let tSum = 0;
    for (let k = 0; k < N * N; k++) tSum += State.temperature[k];
    Globals.tRef = tSum / (N * N);
  }

  Globals.plumes = [];
  initPlumes();

  resetCounters();
}
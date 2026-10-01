// Simulation orchestrator. The pipeline is a flat list of named steps
// with optional `every` (run every N simulation ticks). Each step takes
// (dt, t, stepCount) and mutates State / Globals in place.

import {
  N, RELAX_K, MANTLE_RATE,
  DRIFT_INTERVAL, ADVECT_INTERVAL, FLOW_ROUTING_INTERVAL, CLIMATE_INTERVAL,
  AQ_FLOW_INTERVAL, AQ_MAX, L, BLEND_WIDTH,
} from './constants.js';
import { State, Globals, resetCounters } from './state.js';
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

const H1 = State.H1, H2 = State.H2, H3 = State.H3, H4 = State.H4;

// ---------- Advection of layer heights along plate drift ----------
function advectLayers(dtAdv) {
  const inv = dtAdv / L * N;     // velocity in cell units per dtAdv
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

// ---------- Rain: cloud noise + humidity, split between runoff and aquifer ----------
function rainStep(dt, t) {
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

// ---------- Infiltration + baseflow ----------
function infiltrationStep(dt) {
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

// ---------- H4 relaxation toward target surface + mantle uplift ----------
function relaxStep(dt, t) {
  const pulse = 0.7 + 0.3 * Math.sin(t * 0.11);
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    const target  = State.targetSurface[k];
    const m = State.mantleField[k];
    H4[k] += RELAX_K * (target - surface) * pulse * dt;
    H4[k] += MANTLE_RATE * m * dt;
  }
}

// ---------- Decay aquifer below sea level (it has nowhere to go there) ----------
function aqOceanClamp() {
  for (let k = 0; k < N * N; k++) {
    const surface = H1[k] + H2[k] + H3[k] + H4[k];
    if (surface < Globals.seaLevel) State.Aq[k] = 0;
  }
}

// ---------- Step table ----------
// every: null = every tick, otherwise run when (stepCount % every) === 0
const STEPS = [
  { name: 'drift',     every: DRIFT_INTERVAL,        fn: (dt, t, c) => {
      const dts = DRIFT_INTERVAL * dt;
      driftPlates(dts);
      computeWorleyFields();
      computeMantleField(t);
      const before = countActivePlates();
      updatePlateLifecycle();
      const after = countActivePlates();
      if (after > before) Globals.birthsTotal += (after - before);
      else if (after < before) Globals.deathsTotal += (before - after);
    } },
  { name: 'advect',    every: ADVECT_INTERVAL,       fn: (dt) => { advectLayers(ADVECT_INTERVAL * dt); Globals.advectRuns++; } },
  { name: 'routing',   every: FLOW_ROUTING_INTERVAL, fn: () => { computeFlowRouting(); computeSpillLevels(); Globals.routingRuns++; } },
  { name: 'climate',   every: CLIMATE_INTERVAL,      fn: (dt, t) => { computeClimate(t); updateSeaLevel(); Globals.climateRuns++; } },
  { name: 'volcanoes', every: null,                  fn: () => tickVolcanoes() },
  { name: 'relax',     every: null,                  fn: (dt, t) => relaxStep(dt, t) },
  { name: 'talus',     every: null,                  fn: (dt) => applyTalus(dt) },
  { name: 'lithify',   every: null,                  fn: (dt) => lithify(dt) },
  { name: 'ice',       every: null,                  fn: (dt, t) => Globals.iceEnabled && glacierStep(dt, t) },
  { name: 'wind',      every: null,                  fn: (dt, t) => {
      if (Globals.windEnabled) { windAdvect(dt); windErodeDeposit(dt, t); }
      else dropWindSed();
    } },
  { name: 'rain',      every: null,                  fn: (dt, t) => rainStep(dt, t) },
  { name: 'infiltr',   every: null,                  fn: (dt) => infiltrationStep(dt) },
  { name: 'water',     every: null,                  fn: (dt, c) => advectWater(dt, (c & 1) === 1) },
  { name: 'aq',        every: AQ_FLOW_INTERVAL,      fn: (dt, c) => {
      const aqDt = dt * AQ_FLOW_INTERVAL;
      advectAq(aqDt, (c & 1) === 1);
      aqOceanClamp();
      for (let k = 0; k < N * N; k++) {
        if (State.Aq[k] < 0) State.Aq[k] = 0;
        if (State.Aq[k] > AQ_MAX) State.Aq[k] = AQ_MAX;
      }
    } },
  { name: 'erosion',   every: null,                  fn: (dt) => riverErosion(dt) },
  { name: 'evap',      every: null,                  fn: (dt) => evaporate(dt) },
  { name: 'lakes',     every: null,                  fn: (dt) => applyLakes(dt) },
  { name: 'clamp',     every: null,                  fn: () => clampSafety() },
];

// Plate count is exposed via plates.js.

// ---------- Public API ----------

// ---------- Public API ----------
export function simulate(dt) {
  Globals.simTime += dt;
  Globals.simStepCount++;
  const t = Globals.simTime;
  const c = Globals.simStepCount;
  for (const step of STEPS) {
    if (step.every !== null && (c % step.every) !== 0) continue;
    step.fn(dt, t, c);
  }
}

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

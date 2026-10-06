// Volcanism: place plumes over land or shallow water, erupt periodically,
// and deposit lava + ash + heat. Lava goes into both H4 and lavaBonus so the
// relaxation step can't smooth the cone away.

import { GRID, CLIMATE, VOLCANO } from './constants.js';
const { N } = GRID;
const { SEA_LEVEL_MIN } = CLIMATE;
const { PLUME_COUNT, ERUPT_MIN: PLUME_ERUPT_MIN, ERUPT_MAX: PLUME_ERUPT_MAX,
        CRATER_SIG, CRATER_REACH, LAVA_VOLUME,
        HEAT_RADIUS, HEAT_AMOUNT, HEAT_DECAY,
        ASH_SIG, ASH_VOLUME, ASH_LAYER_MAX } = VOLCANO;
import { State, Globals, H1, H2, H3, H4, surfaceField } from './state.js';

/**
 * Place `PLUME_COUNT` volcano plumes on the world. Each candidate cell
 * must be above `seaLevel − 40` (so deep ocean never spawns a volcano)
 * and far enough (≥ 8 cells) from every existing plume. Up to 500
 * attempts; if we still have fewer than `PLUME_COUNT` we just settle
 * for what we got.
 *
 * Each placed plume gets a random first eruption time 20..80 seconds in
 * the future.
 */
export function initPlumes() {
  Globals.plumes = [];
  let placed = 0;
  let attempts = 0;
  while (placed < PLUME_COUNT && attempts < 500) {
    attempts++;
    const i = Math.floor(Math.random() * N);
    const j = Math.floor(Math.random() * N);
    const k = j * N + i;
    const h = surfaceField[k];
    if (h < Globals.seaLevel - 40) continue;
    let tooClose = false;
    for (let pi = 0; pi < Globals.plumes.length; pi++) {
      const p = Globals.plumes[pi];
      let dxi = (p.i - i + N) % N; if (dxi > N / 2) dxi -= N;
      let dzj = (p.j - j + N) % N; if (dzj > N / 2) dzj -= N;
      if (dxi * dxi + dzj * dzj < 64) { tooClose = true; break; }
    }
    if (tooClose) continue;
    Globals.plumes.push({ i, j, k, nextErupt: Globals.simTime + 20 + Math.random() * 60 });
    placed++;
  }
}

/**
 * Run any plumes whose eruption timer has expired, then decay the
 * `eruptHeat` and `ashLayer` fields multiplicatively. No-op entirely if
 * the user toggled `volcanoesEnabled` off (the H key).
 */
export function tickVolcanoes() {
  if (!Globals.volcanoesEnabled) return;
  for (let i = 0; i < Globals.plumes.length; i++) {
    const v = Globals.plumes[i];
    if (Globals.simTime >= v.nextErupt) {
      eruptPlume(v);
      Globals.eruptionsTotal++;
    }
  }
  // Decay heat and ash
  for (let k = 0; k < N * N; k++) {
    if (State.eruptHeat[k] > 0.001) State.eruptHeat[k] *= HEAT_DECAY;
    else State.eruptHeat[k] = 0;
    if (State.ashLayer[k] > 0.001) State.ashLayer[k] *= 0.9995;
    else State.ashLayer[k] = 0;
  }
}

/**
 * Trigger one eruption at the given plume: deposit a Gaussian-shaped
 * lava falloff into `H4` and `lavaBonus` (so the cone survives the
 * `stepRelax` smoothing), a heat burst near the vent, ash deposition
 * further out, and melt nearby snow/ice. Reschedule the next eruption.
 *
 * @param {{i:number, j:number, k:number, nextErupt:number}} v  Plume descriptor.
 */
function eruptPlume(v) {
  const { i, j, k } = v;
  const isUnderwater = surfaceField[k] < Globals.seaLevel;
  const lavaVolume = isUnderwater ? LAVA_VOLUME * 0.6 : LAVA_VOLUME;

  for (let dj = -CRATER_REACH; dj <= CRATER_REACH; dj++) {
    for (let di = -CRATER_REACH; di <= CRATER_REACH; di++) {
      const d2 = di * di + dj * dj;
      if (d2 > CRATER_REACH * CRATER_REACH) continue;
      const ni = ((i + di) % N + N) % N;
      const nj = ((j + dj) % N + N) % N;
      const kk = nj * N + ni;
      const craterWeight = Math.exp(-d2 / (2 * CRATER_SIG * CRATER_SIG));
      const addH = lavaVolume * craterWeight;
      // Active molten lava only — H4 grows from cooled lavaBonus inside
      // `stepLavaCool` so each eruption doesn't permanently double-dip into
      // the bedrock layer.
      State.lavaBonus[kk] += addH;
      if (d2 < HEAT_RADIUS * HEAT_RADIUS) {
        State.eruptHeat[kk] = Math.min(1, State.eruptHeat[kk] + HEAT_AMOUNT * craterWeight);
        State.snowLayer[kk] = Math.max(0, State.snowLayer[kk] - craterWeight * 2.0);
        State.iceLayer[kk]  = Math.max(0, State.iceLayer[kk]  - craterWeight * 3.0);
      }
      const ashWeight = Math.exp(-d2 / (2 * ASH_SIG * ASH_SIG));
      if (ashWeight > 0.005) {
        const ash = ASH_VOLUME * ashWeight;
        H1[kk] += ash;
        State.ashLayer[kk] = Math.min(ASH_LAYER_MAX, State.ashLayer[kk] + ash);
      }
    }
  }
  v.nextErupt = Globals.simTime + PLUME_ERUPT_MIN +
                Math.random() * (PLUME_ERUPT_MAX - PLUME_ERUPT_MIN);
  Globals.lastEruption = { i, j, t: Globals.simTime, underwater: isUnderwater };
}

// Volcanism: place plumes over land or shallow water, erupt periodically,
// and deposit lava + ash + heat. Lava goes into both H4 and lavaBonus so the
// relaxation step can't smooth the cone away.

import {
  N, SEA_LEVEL_MIN,
  PLUME_COUNT,
  PLUME_ERUPT_MIN, PLUME_ERUPT_MAX,
  CRATER_SIG, CRATER_REACH, LAVA_VOLUME,
  HEAT_RADIUS, HEAT_AMOUNT, HEAT_DECAY,
  ASH_SIG, ASH_VOLUME, ASH_LAYER_MAX,
} from './constants.js';
import { State, Globals } from './state.js';

const H1 = State.H1, H2 = State.H2, H3 = State.H3, H4 = State.H4;

// Initial plume placement: anywhere above sea level with a minimum spacing.
export function initPlumes() {
  Globals.plumes = [];
  let placed = 0;
  let attempts = 0;
  while (placed < PLUME_COUNT && attempts < 500) {
    attempts++;
    const i = Math.floor(Math.random() * N);
    const j = Math.floor(Math.random() * N);
    const k = j * N + i;
    const h = H1[k] + H2[k] + H3[k] + H4[k];
    if (h < Globals.seaLevel - 40) continue;
    let tooClose = false;
    for (const p of Globals.plumes) {
      let dxi = (p.i - i + N) % N; if (dxi > N / 2) dxi -= N;
      let dzj = (p.j - j + N) % N; if (dzj > N / 2) dzj -= N;
      if (dxi * dxi + dzj * dzj < 64) { tooClose = true; break; }
    }
    if (tooClose) continue;
    Globals.plumes.push({ i, j, k, nextErupt: Globals.simTime + 20 + Math.random() * 60 });
    placed++;
  }
}

// Run any plumes whose timer has expired.
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

function eruptPlume(v) {
  const { i, j, k } = v;
  const isUnderwater = (H1[k] + H2[k] + H3[k] + H4[k]) < Globals.seaLevel;
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
      H4[kk] += addH;
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

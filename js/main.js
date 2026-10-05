// Entry point. Initialises the world, wires the requestAnimationFrame loop,
// and ties together simulation, render, player, and UI updates.

import { PLAYER } from './constants.js';
const { EYE } = PLAYER;
import { Globals } from './state.js';
import { resetTerrain, simulate } from './sim.js';
import { sampleHeight } from './surface.js';
import {
  renderer, scene, camera,
  syncTextures, positionTiles,
} from './render.js';
import { tickPlayer, player } from './player.js';
import { renderSlice, renderGraphs, updateHUD, periodicUI } from './ui.js';

// ---------- Fatal-error overlay so failures don't show up as a blank screen ----------
const errBox = (typeof document !== 'undefined') ? document.getElementById('err') : null;
/**
 * Push a fatal error into the `#err` overlay so the failure is visible
 * instead of looking like a hang / blank canvas. Used for `window.error`,
 * `unhandledrejection`, and the wrapped simulation catch in `tick`.
 *
 * @param {string} label  Short label (e.g. `'simulate'`).
 * @param {Error|string} err  The thrown value.
 */
function showError(label, err) {
  console.error(label, err);
  if (!errBox) return;
  errBox.style.display = 'block';
  errBox.textContent =
    `[${label}] ${err?.message || err}\n${err?.stack || ''}`;
}
window.addEventListener('error', e => showError('window.error', e.error || e.message));
window.addEventListener('unhandledrejection', e => showError('unhandledrejection', e.reason));

// Simulation runs at fixed 30 Hz while rendering follows rAF.
const SIM_STEP = 1 / 30;
const MAX_SUBSTEPS = 5;

try {
  resetTerrain(false);
  Globals.feetY = sampleHeight(player.x, player.z);
  syncTextures();
} catch (e) {
  showError('init', e);
  throw e;
}

let last = performance.now();
let simAccum = 0;
let graphTimer = 0;

/**
 * Per-frame callback. Walks the simulation, updates the camera, draws
 * everything, and refreshes the UI. Catches any simulation error so a
 * pipeline bug pauses the sim and surfaces a message instead of
 * freezing the page.
 *
 * @param {number} now  `performance.now()` value passed by rAF.
 */
function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  tickPlayer(dt);

  if (!Globals.paused) {
    simAccum += dt;
    let steps = 0;
    try {
      while (simAccum >= SIM_STEP && steps < MAX_SUBSTEPS) {
        simulate(SIM_STEP);
        simAccum -= SIM_STEP;
        steps++;
      }
    } catch (e) {
      showError('simulate', e);
      Globals.paused = true;
    }
    if (steps > 0) syncTextures();
  }

  camera.position.set(0, Globals.feetY + EYE, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  positionTiles(player.x, player.z);

  if (Globals.showSlice && (Globals.simStepCount % 5 === 0)) renderSlice();
  graphTimer += dt;
  if (Globals.showGraphs && graphTimer > 0.25) {
    graphTimer = 0;
    renderGraphs();
  }

  periodicUI(now);
  try { updateHUD(); } catch (e) { console.error('HUD error:', e); }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

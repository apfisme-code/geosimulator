// First-person controller: WASD movement on the torus, pointer-lock look,
// jump/gravity, and the global key bindings (overlay/pause/restart/…).

import { GRID, PLAYER, OVERLAY } from './constants.js';
const { L, wrap } = GRID;
const { EYE, GRAVITY, JUMP_V, SPEED_WALK, SPEED_RUN } = PLAYER;
const { COUNT: OVERLAY_COUNT, NAMES: OVERLAY_NAMES } = OVERLAY;
import { State, Globals } from './state.js';
import { resetTerrain } from './sim.js';
import { terrainMat, waterMat, renderer } from './render.js';
import { sampleHeight } from './surface.js';

/** Re-export of `Globals.player` so other modules don't have to import
 *  from `./state.js` directly. Pose: `{x, z, yaw, pitch, vy, onGround}`. */
export const player = Globals.player;

/** Currently-held keys indexed by `KeyboardEvent.code`. Updated by the
 *  global `keydown` / `keyup` listeners below. @type {Object<string, boolean>} */
export const keys = Object.create(null);

// ---------- Global key bindings ----------
/**
 * Key bindings:
 * - `P`         pause/resume simulation
 * - `R`         reset world (same seed)
 * - `G`         reset world (new seed)
 * - `T`         toggle rain
 * - `B`         toggle wind
 * - `I`         toggle ice/snow
 * - `V`         toggle volcanoes
 * - `L`         cycle overlay mode (biomes, height, …, aquifers)
 * - `X`         toggle the geological cross-section preview
 * - `Y`         toggle the history graphs
 *
 * Mouse motion (when pointer-locked) drives yaw/pitch directly.
 */
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyP') Globals.paused = !Globals.paused;
  if (e.code === 'KeyR') resetTerrain(false);
  if (e.code === 'KeyG') resetTerrain(true);
  if (e.code === 'KeyT') Globals.rainEnabled = !Globals.rainEnabled;
  if (e.code === 'KeyB') Globals.windEnabled = !Globals.windEnabled;
  if (e.code === 'KeyI') Globals.iceEnabled  = !Globals.iceEnabled;
  if (e.code === 'KeyV') Globals.volcanoesEnabled = !Globals.volcanoesEnabled;
  if (e.code === 'KeyL') {
    Globals.overlayMode = (Globals.overlayMode + 1) % OVERLAY_COUNT;
    terrainMat.uniforms.uOverlayMode.value = Globals.overlayMode;
    waterMat.uniforms.uOverlayMode.value   = Globals.overlayMode;
  }
  if (e.code === 'KeyX') {
    Globals.showSlice = !Globals.showSlice;
    const c = document.getElementById('sliceCanvas');
    if (c) c.style.display = Globals.showSlice ? 'block' : 'none';
  }
  if (e.code === 'KeyY') {
    Globals.showGraphs = !Globals.showGraphs;
    const c = document.getElementById('graphCanvas');
    if (c) c.style.display = Globals.showGraphs ? 'block' : 'none';
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });

// ---------- Pointer lock + look ----------
const startScreen = document.getElementById('start');
startScreen?.addEventListener('click', () => renderer.domElement.requestPointerLock());
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  if (startScreen) startScreen.style.display = document.pointerLockElement ? 'none' : 'grid';
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw   -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  const lim = Math.PI / 2 - 0.01;
  player.pitch = Math.max(-lim, Math.min(lim, player.pitch));
});

// ---------- One simulation frame's worth of motion ----------
/**
 * Apply one frame's worth of movement + gravity to the player.
 * Reads the keyboard state (`keys`), updates `player.x`/`player.z`
 * (wrapped on the torus) and `player.yaw`/`player.pitch`, then
 * integrates `player.vy` against gravity and snaps feet to
 * `sampleHeight` when on the ground.
 *
 * Called once per animation frame from `main.js`, before `simulate()`.
 *
 * @param {number} dt  Real-time step in seconds (already clamped at 0.1).
 */
export function tickPlayer(dt) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  let dx = 0, dz = 0;
  if (keys.KeyW || keys.ArrowUp)    { dx += fx; dz += fz; }
  if (keys.KeyS || keys.ArrowDown)  { dx -= fx; dz -= fz; }
  if (keys.KeyD || keys.ArrowRight) { dx += rx; dz += rz; }
  if (keys.KeyA || keys.ArrowLeft)  { dx -= rx; dz -= rz; }
  const len = Math.hypot(dx, dz);
  if (len > 0) {
    dx /= len; dz /= len;
    const sp = (keys.ShiftLeft || keys.ShiftRight) ? SPEED_RUN : SPEED_WALK;
    player.x = wrap(player.x + dx * sp * dt);
    player.z = wrap(player.z + dz * sp * dt);
  }

  const groundY = sampleHeight(player.x, player.z);
  if (keys.Space && player.onGround) { player.onGround = false; player.vy = JUMP_V; }
  if (player.onGround) Globals.feetY = groundY;
  else {
    player.vy -= GRAVITY * dt; Globals.feetY += player.vy * dt;
    if (Globals.feetY <= groundY) { Globals.feetY = groundY; player.vy = 0; player.onGround = true; }
  }
}

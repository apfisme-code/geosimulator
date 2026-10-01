// First-person controller: WASD movement on the torus, pointer-lock look,
// jump/gravity, and the global key bindings (overlay/pause/restart/…).

import { L, EYE, GRAVITY, JUMP_V, SPEED_WALK, SPEED_RUN } from './constants.js';
import { wrap } from './constants.js';
import { State, Globals } from './state.js';
import { resetTerrain } from './sim.js';
import { OVERLAY_COUNT, OVERLAY_NAMES } from './constants.js';
import { terrainMat, waterMat, renderer } from './render.js';
import { sampleHeight } from './surface.js';

export const player = Globals.player;

export const keys = Object.create(null);

let feetY = 0;
export function setFeetY(v) { feetY = v; }
export function getFeetY() { return feetY; }

// ---------- Global key bindings ----------
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
  if (player.onGround) feetY = groundY;
  else {
    player.vy -= GRAVITY * dt; feetY += player.vy * dt;
    if (feetY <= groundY) { feetY = groundY; player.vy = 0; player.onGround = true; }
  }
  Globals.feetY = feetY;
}

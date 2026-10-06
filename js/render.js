// Render layer: builds the GPU resources (textures, materials, tile meshes)
// and exposes syncTextures() / a tick that positions the tile group around
// the player on the toroidal world.

import * as THREE from 'three';
import { GRID, VOLCANO } from './constants.js';
const { N, NV, NV1, L, cellSize } = GRID;
const { ASH_LAYER_MAX } = VOLCANO;
import { State, Globals } from './state.js';

// ---------- Texture buffers ----------
// All textures are N×N Float32 with RepeatWrapping so the GPU can sample
// seamlessly across tile borders. The back-end `Float32Array` is exposed
// only to `syncTextures()`; consumers read via the `texX` `DataTexture`s.
/** RGBA: H1..H4 stacked into one texture for a single `texture()` call. */
const texHBuf   = new Float32Array(N * N * 4);
/** RG: W (water depth) + temperature. */
const texWBuf   = new Float32Array(N * N * 2);
/** RGBA: sediment, windSed, log(accumulation), humidity. */
const texAuxBuf = new Float32Array(N * N * 4);
/** RGBA: eruptHeat, ash normalised, iceLayer, snowLayer. */
const texVolBuf = new Float32Array(N * N * 4);
/** R: mantleField. */
const texManBuf = new Float32Array(N * N);
/** R: aquifer. */
const texAqBuf  = new Float32Array(N * N);

/**
 * RGBA texture: `(H1, H2, H3, H4)` per cell.
 * @type {THREE.DataTexture}
 */
export const texH = new THREE.DataTexture(texHBuf, N, N, THREE.RGBAFormat, THREE.FloatType);
texH.minFilter = THREE.LinearFilter; texH.magFilter = THREE.LinearFilter;
texH.wrapS = THREE.RepeatWrapping;   texH.wrapT = THREE.RepeatWrapping;
texH.needsUpdate = true;

/**
 * RG texture: `(W, temperature)` per cell.
 * @type {THREE.DataTexture}
 */
export const texW = new THREE.DataTexture(texWBuf, N, N, THREE.RGFormat, THREE.FloatType);
texW.minFilter = THREE.LinearFilter; texW.magFilter = THREE.LinearFilter;
texW.wrapS = THREE.RepeatWrapping;   texW.wrapT = THREE.RepeatWrapping;
texW.needsUpdate = true;

/**
 * RGBA texture: `(Sed, windSed, logUpstream, humidity)` per cell.
 * @type {THREE.DataTexture}
 */
export const texAux = new THREE.DataTexture(texAuxBuf, N, N, THREE.RGBAFormat, THREE.FloatType);
texAux.minFilter = THREE.LinearFilter; texAux.magFilter = THREE.LinearFilter;
texAux.wrapS = THREE.RepeatWrapping;   texAux.wrapT = THREE.RepeatWrapping;
texAux.needsUpdate = true;

/**
 * RGBA texture: `(eruptHeat, ash normalised, iceLayer, snowLayer)` per cell.
 * @type {THREE.DataTexture}
 */
export const texVol = new THREE.DataTexture(texVolBuf, N, N, THREE.RGBAFormat, THREE.FloatType);
texVol.minFilter = THREE.LinearFilter; texVol.magFilter = THREE.LinearFilter;
texVol.wrapS = THREE.RepeatWrapping;   texVol.wrapT = THREE.RepeatWrapping;
texVol.needsUpdate = true;

/**
 * R texture: `mantleField` per cell (used by the tectonics overlay).
 * @type {THREE.DataTexture}
 */
export const texMantle = new THREE.DataTexture(texManBuf, N, N, THREE.RedFormat, THREE.FloatType);
texMantle.minFilter = THREE.LinearFilter; texMantle.magFilter = THREE.LinearFilter;
texMantle.wrapS = THREE.RepeatWrapping;   texMantle.wrapT = THREE.RepeatWrapping;
texMantle.needsUpdate = true;

/**
 * R texture: aquifer level per cell.
 * @type {THREE.DataTexture}
 */
export const texAq = new THREE.DataTexture(texAqBuf, N, N, THREE.RedFormat, THREE.FloatType);
texAq.minFilter = THREE.LinearFilter; texAq.magFilter = THREE.LinearFilter;
texAq.wrapS = THREE.RepeatWrapping;   texAq.wrapT = THREE.RepeatWrapping;
texAq.needsUpdate = true;

/**
 * Push the latest `State` snapshot into every GPU texture. Called once
 * per frame from `main.js` after `simulate()` runs. Logs an `ashLayer`
 * entry normalised by `ASH_LAYER_MAX` so the overlay slider can reach 1.
 */
export function syncTextures() {
  for (let k = 0; k < N * N; k++) {
    const k4 = k * 4, k2 = k * 2;
    texHBuf[k4    ] = State.H1[k];
    texHBuf[k4 + 1] = State.H2[k];
    texHBuf[k4 + 2] = State.H3[k];
    texHBuf[k4 + 3] = State.H4[k];
    texAuxBuf[k4    ] = State.Sed[k];
    texAuxBuf[k4 + 1] = State.windSed[k];
    texAuxBuf[k4 + 2] = Math.min(1.5, Math.log(1 + State.flowAccumRouting[k]) * 0.25);
    texAuxBuf[k4 + 3] = State.humidity[k];
    texWBuf[k2    ] = State.W[k];
    texWBuf[k2 + 1] = State.temperature[k];
    texVolBuf[k4    ] = State.eruptHeat[k];
    texVolBuf[k4 + 1] = Math.min(1, State.ashLayer[k] / ASH_LAYER_MAX);
    texVolBuf[k4 + 2] = State.iceLayer[k];
    texVolBuf[k4 + 3] = State.snowLayer[k];
    texManBuf[k] = State.mantleField[k];
    texAqBuf[k] = State.Aq[k];
  }
  texH.needsUpdate = true;
  texW.needsUpdate = true;
  texAux.needsUpdate = true;
  texVol.needsUpdate = true;
  texMantle.needsUpdate = true;
  texAq.needsUpdate = true;
}

// ---------- Terrain mesh ----------
/**
 * Build the per-tile grid geometry: a flat (NV+1)² grid covering one
 * tile of side `L`, with UVs normalised to `[0, 1]` for seamless texture
 * sampling across tile boundaries. Two triangles per cell.
 *
 * @returns {THREE.BufferGeometry}  Geometry suitable for both the terrain
 *                                  and water meshes (they share UVs and
 *                                  topology; only the vertex shader differs).
 */
function buildGridGeometry() {
  const geo = new THREE.BufferGeometry();
  const V = NV1 * NV1;
  const verts = new Float32Array(V * 3);
  const uvs   = new Float32Array(V * 2);
  const step = L / NV;
  for (let j = 0; j < NV1; j++) {
    const jV = j * NV1;
    const uj = j / NV;
    const z = j * step;
    for (let i = 0; i < NV1; i++) {
      const vi = jV + i;
      verts[vi * 3    ] = i * step;
      verts[vi * 3 + 1] = 0;
      verts[vi * 3 + 2] = z;
      uvs[vi * 2    ] = i / NV;
      uvs[vi * 2 + 1] = uj;
    }
  }
  const totalTri = NV * NV * 2;
  const idx = new Uint32Array(totalTri * 3);
  let p = 0;
  for (let j = 0; j < NV; j++) {
    const jV = j * NV1, jVn = (j + 1) * NV1;
    for (let i = 0; i < NV; i++) {
      const a = jV + i, b = a + 1, c = jVn + i, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 200;
  return geo;
}

// ---------- Shaders ----------
// Two vertex shaders sharing the same uniforms. They differ in the
// varying set: terrainFS needs the soil-layer, plate-tectonics and
// atmosphere overlays; waterFS only needs the water/ice/snow + ocean
// climate channels. Keeping them separate means the water geometry
// pays zero cost for the extra 4 varyings it would otherwise carry.
//
// Both compute surface from the height-stack texture (sum of H1..H4),
// set `pos.y` differently for land vs sea/ice, and write a world-space
// normal from the cross-cell height gradient.
const terrainVS = `
  uniform sampler2D texH;
  uniform sampler2D texW;
  uniform sampler2D texAux;
  uniform sampler2D texVol;
  uniform sampler2D texMantle;
  uniform sampler2D texAq;
  uniform vec2 uTexel;
  uniform float uCellSize;
  uniform float uWaterMix;
  uniform float uSeaLevel;

  out vec3  vWorld;
  out vec3  vNormalW;
  out float vH;
  out float vW;
  out float vWind;
  out float vDrainage;
  out float vTemp;
  out float vHum;
  out float vHeat;
  out float vAsh;
  out float vIce;
  out float vSnow;
  out float vMantle;
  out float vAq;

  void main() {
    vec2 uvc = uv;
    vec4 h4  = texture(texH, uvc);
    vec2 wt  = texture(texW, uvc).rg;
    vec4 aux = texture(texAux, uvc);
    vec4 vol = texture(texVol, uvc);
    float mantle = texture(texMantle, uvc).r;
    float aq = texture(texAq, uvc).r;

    float w   = wt.r;
    float t   = wt.g;
    float ice = vol.b;
    float snow= vol.a;

    float surface = h4.x + h4.y + h4.z + h4.w;

    vec3 pos = position;
    float snowOnLand = surface > uSeaLevel ? snow : 0.0;
    pos.y = surface + snowOnLand;

    float e = uTexel.x;
    vec4 hL = texture(texH, uvc - vec2(e, 0.0));
    vec4 hR = texture(texH, uvc + vec2(e, 0.0));
    vec4 hD = texture(texH, uvc - vec2(0.0, e));
    vec4 hU = texture(texH, uvc + vec2(0.0, e));
    float dHdx = ((hR.x+hR.y+hR.z+hR.w) - (hL.x+hL.y+hL.z+hL.w)) / (2.0 * uCellSize);
    float dHdz = ((hU.x+hU.y+hU.z+hU.w) - (hD.x+hD.y+hD.z+hD.w)) / (2.0 * uCellSize);
    vec3 nrm = normalize(vec3(-dHdx, 1.0, -dHdz));

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld   = world.xyz;
    // Tiles are pure translation (set per-frame in positionTiles), so
    // the world-space normal is just the local normal — no mat3 needed.
    vNormalW = nrm;
    vH   = surface;
    vW   = w;
    vWind = aux.y;
    vDrainage = aux.z;
    vTemp = t;
    vHum = aux.w;
    vHeat = vol.r;
    vAsh = vol.g;
    vIce = ice;
    vSnow = snow;
    vMantle = mantle;
    vAq = aq;

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const waterVS = `
  uniform sampler2D texH;
  uniform sampler2D texW;
  uniform sampler2D texAux;
  uniform sampler2D texVol;
  uniform sampler2D texMantle;
  uniform sampler2D texAq;
  uniform vec2 uTexel;
  uniform float uCellSize;
  uniform float uWaterMix;
  uniform float uSeaLevel;

  out vec3  vWorld;
  out vec3  vNormalW;
  out float vW;
  out float vSed;
  out float vTemp;
  out float vHeat;
  out float vIce;
  out float vSnow;
  out float vH;
  out float vDrainage;
  out float vHum;
  out float vAq;

  void main() {
    vec2 uvc = uv;
    vec4 h4  = texture(texH, uvc);
    vec2 wt  = texture(texW, uvc).rg;
    vec4 aux = texture(texAux, uvc);
    vec4 vol = texture(texVol, uvc);

    float w   = wt.r;
    float t   = wt.g;
    float ice = vol.b;
    float snow= vol.a;

    // Water doesn't need the soil/tectonics varyings (no vH1, vWind,
    // vAsh, vMantle). The visible water surface is always sea level
    // (with freeboard from sea-ice).
    vec3 pos = position;
    float hasIce = step(0.02, ice);
    pos.y = uSeaLevel + hasIce * (0.08 * ice + snow);

    float e = uTexel.x;
    vec4 hL = texture(texH, uvc - vec2(e, 0.0));
    vec4 hR = texture(texH, uvc + vec2(e, 0.0));
    vec4 hD = texture(texH, uvc - vec2(0.0, e));
    vec4 hU = texture(texH, uvc + vec2(0.0, e));
    float dHdx = ((hR.x+hR.y+hR.z+hR.w) - (hL.x+hL.y+hL.z+hL.w)) / (2.0 * uCellSize);
    float dHdz = ((hU.x+hU.y+hU.z+hU.w) - (hD.x+hD.y+hD.z+hD.w)) / (2.0 * uCellSize);
    vec3 nrm = normalize(vec3(-dHdx, 1.0, -dHdz));

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld   = world.xyz;
    // Tiles are pure translation, so world-space normal = local normal.
    vNormalW = nrm;
    vW   = w;
    vSed = aux.x;
    vTemp = t;
    vHeat = vol.r;
    vIce = ice;
    vSnow = snow;
    vH   = h4.x + h4.y + h4.z + h4.w;
    vDrainage = aux.z;
    vHum = aux.w;
    vAq = texture(texAq, uvc).r;

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const terrainFS = `
  uniform vec3  uLightDir;
  uniform vec3  uAmbient;
  uniform vec3  uSunColor;
  uniform vec3  uMoonDir;
  uniform vec3  uMoonColor;
  uniform int   uOverlayMode;

  in vec3  vWorld;
  in vec3  vNormalW;
  in float vH;
  in float vW;
  in float vWind;
  in float vDrainage;
  in float vTemp;
  in float vHum;
  in float vHeat;
  in float vAsh;
  in float vIce;
  in float vSnow;
  in float vMantle;
  in float vAq;

  out vec4 fragColor;

  vec3 biomeColor(float t, float h) {
    vec3 ice     = vec3(0.92, 0.95, 1.00);
    vec3 tundra  = vec3(0.62, 0.65, 0.60);
    vec3 taiga   = vec3(0.22, 0.38, 0.25);
    vec3 steppe  = vec3(0.72, 0.68, 0.42);
    vec3 forest  = vec3(0.18, 0.42, 0.18);
    vec3 desert  = vec3(0.90, 0.80, 0.52);
    vec3 savanna = vec3(0.62, 0.62, 0.32);
    vec3 jungle  = vec3(0.12, 0.45, 0.08);
    vec3 coldCol, tempCol, hotCol;
    if (h < 0.30)      coldCol = mix(tundra, ice,    (0.30 - h) / 0.30);
    else if (h < 0.70) coldCol = mix(tundra, taiga,  (h - 0.30) / 0.40);
    else               coldCol = taiga;
    if (h < 0.30)      tempCol = steppe;
    else if (h < 0.70) tempCol = mix(steppe, forest, (h - 0.30) / 0.40);
    else               tempCol = forest;
    if (h < 0.30)      hotCol = desert;
    else if (h < 0.70) hotCol = mix(desert, jungle,  (h - 0.30) / 0.40);
    else               hotCol = jungle;
    if (t < 0.30) return mix(coldCol, tempCol, t / 0.30);
    if (t < 0.60) return mix(tempCol, hotCol, (t - 0.30) / 0.30);
    return hotCol;
  }
  vec3 heightColor(float h) {
    float t = clamp((h + 60.0) / 140.0, 0.0, 1.0);
    vec3 blue  = vec3(0.10, 0.25, 0.55);
    vec3 cyan  = vec3(0.20, 0.70, 0.80);
    vec3 green = vec3(0.15, 0.60, 0.20);
    vec3 yel   = vec3(0.85, 0.85, 0.20);
    vec3 red   = vec3(0.85, 0.20, 0.10);
    vec3 white = vec3(1.0, 1.0, 1.0);
    if (t < 0.20) return mix(blue,  cyan,  t / 0.20);
    if (t < 0.45) return mix(cyan,  green, (t - 0.20) / 0.25);
    if (t < 0.70) return mix(green, yel,   (t - 0.45) / 0.25);
    if (t < 0.90) return mix(yel,   red,   (t - 0.70) / 0.20);
    return mix(red, white, (t - 0.90) / 0.10);
  }
  vec3 tempColor(float t) {
    vec3 cold = vec3(0.10, 0.30, 0.85);
    vec3 warm = vec3(0.95, 0.95, 0.20);
    vec3 hot  = vec3(0.85, 0.10, 0.05);
    if (t < 0.5) return mix(cold, warm, t * 2.0);
    return mix(warm, hot, (t - 0.5) * 2.0);
  }
  vec3 humColor(float h) {
    vec3 dry = vec3(0.85, 0.65, 0.30);
    vec3 wet = vec3(0.15, 0.45, 0.85);
    return mix(dry, wet, h);
  }
  vec3 drainColor(float d) {
    float v = clamp(d * 1.5, 0.0, 1.0);
    return mix(vec3(0.15, 0.15, 0.15), vec3(0.20, 0.80, 0.95), v);
  }
  vec3 snowColor(float s) {
    return mix(vec3(0.20, 0.25, 0.35), vec3(1.0, 1.0, 1.0), clamp(s / 1.5, 0.0, 1.0));
  }
  vec3 iceColor(float i) {
    return mix(vec3(0.10, 0.15, 0.30), vec3(0.55, 0.85, 1.0), clamp(i / 2.0, 0.0, 1.0));
  }
  vec3 mantleColor(float m) {
    float v = clamp(m * 1.5 + 0.5, 0.0, 1.0);
    vec3 neg = vec3(0.20, 0.40, 0.85);
    vec3 mid = vec3(0.20, 0.20, 0.20);
    vec3 pos = vec3(0.95, 0.35, 0.15);
    if (v < 0.5) return mix(neg, mid, v * 2.0);
    return mix(mid, pos, (v - 0.5) * 2.0);
  }
  vec3 aqColor(float a) {
    float v = clamp(a / 0.5, 0.0, 1.0);
    vec3 dry = vec3(0.55, 0.42, 0.25);
    vec3 wet = vec3(0.15, 0.65, 0.85);
    return mix(dry, wet, v);
  }

  void main() {
    vec3 col;
    if (uOverlayMode == 0) {
      col = biomeColor(vTemp, vHum);
      if (vSnow > 0.05) {
        float snowAmt = smoothstep(0.05, 1.0, vSnow);
        col = mix(col, vec3(0.95, 0.97, 1.0), snowAmt);
      } else if (vTemp < 0.22) {
        col = mix(col, vec3(0.95, 0.97, 1.0), smoothstep(0.22, 0.08, vTemp));
      }
      float drain = clamp(vDrainage * 1.8, 0.0, 1.0);
      vec3 riverColor = vec3(0.15, 0.35, 0.55);
      col = mix(col, col * 0.65, drain * 0.6);
      col = mix(col, riverColor, drain * drain * 0.45);
      float slope = 1.0 - normalize(vNormalW).y;
      col = mix(col, vec3(0.42, 0.38, 0.34), smoothstep(0.30, 0.70, slope) * 0.65);
      if (vAsh > 0.02) col = mix(col, vec3(0.28, 0.25, 0.22), vAsh * 0.7);
      float dust = min(1.0, vWind * 60.0);
      if (dust > 0.02) col = mix(col, vec3(0.78, 0.66, 0.42), dust * 0.25);
    } else if (uOverlayMode == 1) col = heightColor(vH);
    else if (uOverlayMode == 2) col = tempColor(vTemp);
    else if (uOverlayMode == 3) col = humColor(vHum);
    else if (uOverlayMode == 4) col = drainColor(vDrainage);
    else if (uOverlayMode == 5) col = snowColor(vSnow);
    else if (uOverlayMode == 6) col = iceColor(vIce);
    else if (uOverlayMode == 7) col = mantleColor(vMantle);
    else col = aqColor(vAq);

    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 L = normalize(uLightDir);
    float diff = max(dot(N, L), 0.0);
    vec3 Lm = normalize(uMoonDir);
    float diffM = max(dot(N, Lm), 0.0);
    float lightFactor = (uOverlayMode == 0) ? 1.0 : 0.55;
    vec3 colOut = col * (uAmbient * lightFactor
                        + (uSunColor * diff + uMoonColor * diffM) * lightFactor
                        + (1.0 - lightFactor) * 0.5);

    if (uOverlayMode == 0 && vHeat > 0.02) {
      vec3 lava = vec3(1.0, 0.35, 0.05);
      colOut = mix(colOut, lava, vHeat * 0.8);
      colOut += vec3(1.0, 0.45, 0.1) * vHeat * vHeat * 1.5;
    }

    fragColor = vec4(colOut, 1.0);
  }
`;

const waterFS = `
  uniform vec3  uLightDir;
  uniform vec3  uAmbient;
  uniform vec3  uSunColor;
  uniform vec3  uMoonDir;
  uniform vec3  uMoonColor;
  uniform vec3  uCamera;
  uniform int   uOverlayMode;
  in vec3  vWorld;
  in vec3  vNormalW;
  in float vW;
  in float vSed;
  in float vTemp;
  in float vHeat;
  in float vIce;
  in float vSnow;
  in float vH;
  in float vDrainage;
  in float vHum;
  in float vAq;

  out vec4 fragColor;

  void main() {
    if (vW < 0.0003 && vIce < 0.02) discard;
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 L = normalize(uLightDir);
    vec3 Lm = normalize(uMoonDir);
    vec3 V = normalize(uCamera - vWorld);
    vec3 Hv = normalize(L + V);
    float diff = max(dot(N, L), 0.0);
    float diffM = max(dot(N, Lm), 0.0);

    if (uOverlayMode != 0) {
      vec3 col;
      if (uOverlayMode == 1) {
        float t = clamp((vH + 60.0) / 140.0, 0.0, 1.0);
        col = mix(vec3(0.10, 0.25, 0.55), vec3(0.20, 0.70, 0.80), t);
      } else if (uOverlayMode == 2) col = mix(vec3(0.10, 0.30, 0.85), vec3(0.95, 0.95, 0.20), vTemp);
      else if (uOverlayMode == 3) col = mix(vec3(0.85, 0.65, 0.30), vec3(0.15, 0.45, 0.85), vHum);
      else if (uOverlayMode == 4) col = mix(vec3(0.15), vec3(0.20, 0.80, 0.95), clamp(vDrainage * 1.5, 0.0, 1.0));
      else if (uOverlayMode == 5) col = mix(vec3(0.20, 0.25, 0.35), vec3(1.0), clamp(vSnow / 1.5, 0.0, 1.0));
      else if (uOverlayMode == 6) col = mix(vec3(0.10, 0.15, 0.30), vec3(0.55, 0.85, 1.0), clamp(vIce / 2.0, 0.0, 1.0));
      else if (uOverlayMode == 8) col = mix(vec3(0.55, 0.42, 0.25), vec3(0.15, 0.65, 0.85), clamp(vAq / 0.5, 0.0, 1.0));
      else col = vec3(0.2);
      fragColor = vec4(col * (0.5 + diff * 0.3), 0.75);
      return;
    }

    if (vIce > 0.02) {
      vec3 iceCol = mix(vec3(0.82, 0.90, 1.0), vec3(0.94, 0.96, 1.0),
                        clamp(vIce * 0.3, 0.0, 1.0));
      if (vSnow > 0.02) iceCol = mix(iceCol, vec3(0.98, 0.99, 1.0), clamp(vSnow, 0.0, 1.0));
      float spec = pow(max(dot(N, Hv), 0.0), 120.0);
      vec3 colOut = iceCol * (uAmbient + uSunColor * diff + uMoonColor * diffM);
      colOut += vec3(0.85, 0.92, 1.0) * spec * 0.7;
      if (vHeat > 0.02) colOut = mix(colOut, vec3(0.7, 0.35, 0.25), vHeat * 0.5);
      fragColor = vec4(colOut, 1.0);
      return;
    }

    float d = clamp(vW * 4.0, 0.0, 1.0);
    vec3 base = mix(vec3(0.29, 0.62, 0.81), vec3(0.04, 0.15, 0.25), d);
    if (vTemp < 0.12) base = mix(base, vec3(0.88, 0.94, 1.0), smoothstep(0.12, 0.02, vTemp));
    if (vHeat > 0.02) base = mix(base, vec3(0.7, 0.35, 0.25), vHeat * 0.5);
    float turb = clamp(vSed / max(vW, 0.001) * 3.0, 0.0, 1.0);
    base = mix(base, vec3(0.37, 0.29, 0.18), turb * 0.4);
    float spec = pow(max(dot(N, Hv), 0.0), 140.0);
    vec3 col = base * (uAmbient * 0.7 + uSunColor * diff + uMoonColor * diffM);
    col += vec3(0.81, 0.89, 1.0) * spec * 0.9;
    float alpha = clamp(sqrt(vW * 2.0), 0.0, 0.85);
    alpha = max(alpha, clamp(vW * 25.0, 0.0, 0.85));
    fragColor = vec4(col, alpha);
  }
`;

// ---------- Renderer / scene / camera ----------
/** WebGL2 renderer used to present the scene. Appended to `<body>` and
 *  sized to the viewport; resize handler is registered at the bottom of
 *  this module. @type {THREE.WebGLRenderer} */
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const skyColor = new THREE.Color(0x8fadc9);
/** Three.js scene containing lights + the 3×3 tile group.
 *  @type {THREE.Scene} */
export const scene = new THREE.Scene();
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, L * 0.15, L * 0.55);

/** Perspective camera positioned at the player every frame.
 *  @type {THREE.PerspectiveCamera} */
export const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, L * 2);

/** Length of one full day-night cycle in simulated seconds (20 min).
 *  @type {number} */
const DAY_CYCLE_SEC = 1200;

// Shadow camera orthographic extent — must cover the visible 3×3 tile
// block around the player. 3·L = 960, but the player mostly sees the
// central ~1.5·L region, so 400 each side (800×800) is plenty.
const SHADOW_HALF = 400;

/** Sun directional light — casts shadows. Position is updated every
 *  frame from `updateDayNight()`. @type {THREE.DirectionalLight} */
const sun = new THREE.DirectionalLight(0xfff0d0, 1.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far  = 700;
sun.shadow.camera.left   = -SHADOW_HALF;
sun.shadow.camera.right  =  SHADOW_HALF;
sun.shadow.camera.top    =  SHADOW_HALF;
sun.shadow.camera.bottom = -SHADOW_HALF;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
sun.shadow.radius = 3;
sun.position.set(120, 220, 60);
scene.add(sun);
scene.add(sun.target);

/** Moon directional light — opposite of sun, dim and bluish. Also
 * casts its own shadow map so night-time terrain stays readable.
 * @type {THREE.DirectionalLight} */
const moon = new THREE.DirectionalLight(0xb0c4ff, 0);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.near = 1;
moon.shadow.camera.far  = 700;
moon.shadow.camera.left   = -SHADOW_HALF;
moon.shadow.camera.right  =  SHADOW_HALF;
moon.shadow.camera.top    =  SHADOW_HALF;
moon.shadow.camera.bottom = -SHADOW_HALF;
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.05;
moon.shadow.radius = 4;
moon.position.set(-120, -60, 60);
scene.add(moon);
scene.add(moon.target);

/** Ambient fill — colour + intensity track the sky. The custom terrain
 * and water shaders use `uAmbient` (this feed goes into that uniform too).
 * @type {THREE.AmbientLight} */
const ambient = new THREE.AmbientLight(0x405a80, 0.6);
scene.add(ambient);

// ---------- Materials ----------
/**
 * Shader material for the land surface. GLSL3 / WebGL2.
 *
 * Uniforms:
 * - `texH`/`texW`/`texAux`/`texVol`/`texMantle`/`texAq` — the data textures.
 * - `uTexel`/`uCellSize` — texel size in UV space and world-space cell size.
 * - `uWaterMix`/`uSeaLevel` — currently unused by terrain but kept for symmetry.
 * - `uOverlayMode` — int 0..8 selecting the colour map.
 * - `uLightDir`/`uAmbient`/`uSunColor` — diffuse lighting inputs.
 *
 * @type {THREE.ShaderMaterial}
 */
export const terrainMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    texH:      { value: texH },
    texW:      { value: texW },
    texAux:    { value: texAux },
    texVol:    { value: texVol },
    texMantle: { value: texMantle },
    texAq:     { value: texAq },
    uTexel:    { value: new THREE.Vector2(1 / N, 1 / N) },
    uCellSize: { value: cellSize },
    uWaterMix: { value: 0.0 },
    uSeaLevel: { value: 0.0 },
    uOverlayMode: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(0xfff0d0) },
    uMoonDir:  { value: new THREE.Vector3(-0.3, 0.8, 0.3).normalize() },
    uMoonColor: { value: new THREE.Color(0x000000) },
    uAmbient:  { value: new THREE.Color(0x405a80) },
  },
  vertexShader: terrainVS,
  fragmentShader: terrainFS,
});

/**
 * Shader material for the water surface. GLSL3 / WebGL2.
 * Same data inputs as `terrainMat` but a different vertex/fragment shader:
 * the water mesh is at sea level with optional ice freeboard on top, and
 * is rendered with `transparent: true`, `depthWrite: false` and
 * `DoubleSide` so the back of waves doesn't disappear underwater.
 *
 * @type {THREE.ShaderMaterial}
 */
export const waterMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    texH:      { value: texH },
    texW:      { value: texW },
    texAux:    { value: texAux },
    texVol:    { value: texVol },
    texMantle: { value: texMantle },
    texAq:     { value: texAq },
    uTexel:    { value: new THREE.Vector2(1 / N, 1 / N) },
    uCellSize: { value: cellSize },
    uWaterMix: { value: 1.0 },
    uSeaLevel: { value: 0.0 },
    uOverlayMode: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(0xfff0d0) },
    uMoonDir:  { value: new THREE.Vector3(-0.3, 0.8, 0.3).normalize() },
    uMoonColor: { value: new THREE.Color(0x000000) },
    uAmbient:  { value: new THREE.Color(0x405a80) },
    uCamera:   { value: new THREE.Vector3() },
  },
  vertexShader: waterVS,
  fragmentShader: waterFS,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// ---------- Custom depth materials for shadow casting ----------
// The terrain vertex shader does displacement via the texH texture, so
// the default flat geometry won't cast correct depth. We re-implement
// the same displacement here for the shadow pass.
const terrainDepthVS = `
  uniform sampler2D texH;
  uniform sampler2D texVol;
  uniform float uSeaLevel;

  void main() {
    vec2 uvc = uv;
    vec4 h4 = texture(texH, uvc);
    float surface = h4.x + h4.y + h4.z + h4.w;
    float snow = texture(texVol, uvc).a;
    float snowOnLand = surface > uSeaLevel ? snow : 0.0;
    vec3 pos = position;
    pos.y = surface + snowOnLand;
    vec4 world = modelMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const terrainDepthFS = `
  precision highp float;
  vec4 packDepthToRGBA(float v) {
    vec4 r = vec4(fract(v * vec3(256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0)));
    r.yzw -= r.xyz * (1.0 / 256.0);
    return r * (256.0 / 255.0);
  }
  out vec4 fragColor;
  void main() { fragColor = packDepthToRGBA(gl_FragCoord.z); }
`;
/** Shadow depth material for terrain — re-uses `terrainMat`'s uniforms
 *  so it always sees the latest height stack. @type {THREE.ShaderMaterial} */
const terrainDepthMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: terrainMat.uniforms,
  vertexShader: terrainDepthVS,
  fragmentShader: terrainDepthFS,
});

const waterDepthVS = `
  uniform sampler2D texH;
  uniform sampler2D texVol;
  uniform float uSeaLevel;

  void main() {
    vec2 uvc = uv;
    vec4 vol = texture(texVol, uvc);
    vec3 pos = position;
    float hasIce = step(0.02, vol.b);
    pos.y = uSeaLevel + hasIce * (0.08 * vol.b + vol.a);
    vec4 world = modelMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const waterDepthFS = terrainDepthFS;
/** Shadow depth material for water. @type {THREE.ShaderMaterial} */
const waterDepthMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: waterMat.uniforms,
  vertexShader: waterDepthVS,
  fragmentShader: waterDepthFS,
});

// ---------- Sun & moon visual discs ----------
/** Build a 256² canvas with a radial gradient — used for the sun/moon
 *  sprite textures. @param {string[]} stops  [pos, rgba, pos, rgba, …]
 *  @returns {THREE.CanvasTexture} */
function makeDiscTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let i = 0; i < stops.length; i += 2) {
    grad.addColorStop(stops[i], stops[i + 1]);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sun sprite — placed far away in the sun direction. @type {THREE.Sprite} */
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeDiscTexture([
    0.00, 'rgba(255, 248, 220, 1.00)',
    0.18, 'rgba(255, 235, 180, 0.95)',
    0.36, 'rgba(255, 200, 130, 0.55)',
    0.55, 'rgba(255, 160,  90, 0.20)',
    1.00, 'rgba(255, 110,  50, 0.00)',
  ]),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  // The sun and moon are far away (~460u) but the scene fog is tuned for
  // terrain (48..176u) so without `fog: false` they fade into haze.
  fog: false,
}));
sunSprite.scale.set(60, 60, 1);
sunSprite.renderOrder = 2;
scene.add(sunSprite);

/** Moon sprite — placed opposite the sun. @type {THREE.Sprite} */
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeDiscTexture([
    0.00, 'rgba(255, 255, 250, 1.00)',
    0.30, 'rgba(230, 232, 235, 0.95)',
    0.42, 'rgba(180, 188, 200, 0.45)',
    0.55, 'rgba(120, 135, 165, 0.15)',
    1.00, 'rgba( 80, 100, 140, 0.00)',
  ]),
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  // Disable fog so the disc stays visible even though it sits far
  // beyond the scene's terrain-tuned fog distance.
  fog: false,
}));
moonSprite.scale.set(45, 45, 1);
moonSprite.renderOrder = 2;
scene.add(moonSprite);

// ---------- Toroidal tile group (3×3 around the player) ----------
const terrainGeo = buildGridGeometry();
/** 3×3 grid of land tiles around the player. Each entry is
 *  `{mesh, i, j}` with `i, j ∈ {-1, 0, 1}`. @type {Array<{mesh:THREE.Mesh, i:number, j:number}>} */
export const terrainTiles = [];
/** 3×3 grid of water tiles around the player. Same shape as `terrainTiles`.
 *  @type {Array<{mesh:THREE.Mesh, i:number, j:number}>} */
export const waterTiles = [];
for (let i = -1; i <= 1; i++) {
  for (let j = -1; j <= 1; j++) {
    const mt = new THREE.Mesh(terrainGeo, terrainMat);
    mt.matrixAutoUpdate = false; mt.frustumCulled = false;
    mt.castShadow    = true;
    mt.receiveShadow = true;
    mt.customDepthMaterial = terrainDepthMat;
    scene.add(mt); terrainTiles.push({ mesh: mt, i, j });

    const mw = new THREE.Mesh(terrainGeo, waterMat);
    mw.matrixAutoUpdate = false; mw.frustumCulled = false;
    mw.renderOrder = 1;
    mw.castShadow    = true;
    mw.receiveShadow = false;
    mw.customDepthMaterial = waterDepthMat;
    scene.add(mw); waterTiles.push({ mesh: mw, i, j });
  }
}

/**
 * Place the 3×3 tile group around the player so the world appears
 * infinite. Each tile's mesh position is `i·L − playerX` (and `j·L −
 * playerZ`), so when the player moves east by one world unit, every tile
 * slides west by one unit. We also push the current camera position and
 * sea level into the water/terrain material uniforms.
 *
 * Called from `main.js` on every animation frame, after the camera has
 * been moved.
 *
 * @param {number} playerX  Player world X.
 * @param {number} playerZ  Player world Z.
 */
export function positionTiles(playerX, playerZ) {
  for (const t of terrainTiles) {
    t.mesh.position.set(t.i * L - playerX, 0, t.j * L - playerZ);
    t.mesh.updateMatrix();
  }
  for (const t of waterTiles) {
    t.mesh.position.set(t.i * L - playerX, 0, t.j * L - playerZ);
    t.mesh.updateMatrix();
  }
  waterMat.uniforms.uCamera.value.copy(camera.position);
  waterMat.uniforms.uSeaLevel.value = Globals.seaLevel;
  terrainMat.uniforms.uSeaLevel.value = Globals.seaLevel;
}

/**
 * Drive the day/night cycle. The cycle is `DAY_CYCLE_SEC` simulated
 * seconds long; one tick maps to a phase `t = simTime / cycle` and we
 * compute sun/moon position, colour, intensity, sky colour, fog colour,
 * and push the relevant uniforms into the terrain and water materials.
 *
 * The 24 h curve:
 *   t = 0.00  → midnight   (sun below horizon, moon overhead)
 *   t = 0.25  → 6 am       (sun on east horizon,  dawn)
 *   t = 0.50  → noon       (sun overhead, moon below)
 *   t = 0.75  → 6 pm       (sun on west horizon, dusk)
 *
 * `sunElev = −cos(2π·t)`  (1 at noon, −1 at midnight)
 * `sunAzim = sin(2π·t)`   (east positive, west negative)
 *
 * A small southward tilt (sz = 0.35) keeps shadows cast on the ground
 * even when the sun is directly overhead.
 *
 * Called from `main.js` once per animation frame.
 *
 * @param {number} simTime  Accumulated simulated seconds.
 */
export function updateDayNight(simTime) {
  const dayFrac = ((simTime % DAY_CYCLE_SEC) + DAY_CYCLE_SEC) % DAY_CYCLE_SEC / DAY_CYCLE_SEC;
  const ang = dayFrac * Math.PI * 2;
  Globals.dayPhase = dayFrac;

  // Sun direction (where the light comes FROM). y is elevation in [−1,1].
  const sunElev = -Math.cos(ang);
  const sunAzim =  Math.sin(ang);
  const sx = sunAzim * 0.55;
  const sy = Math.max(-0.20, sunElev);
  const sz = 0.35;
  const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
  const sxN = sx / sl, syN = sy / sl, szN = sz / sl;

  sun.position.set(sxN * 300, syN * 300, szN * 300);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();

  // Smooth ramp over the horizon — below sunElev 0.02 the light is off,
  // ramps up over a 0.16-unit band to full at sunrise, then stays at 1
  // until sunset. Same curve on the way down.
  let sunFactor;
  if      (sunElev <  0.02) sunFactor = 0;
  else if (sunElev <  0.18) sunFactor = (sunElev - 0.02) / 0.16;
  else                      sunFactor = 1;
  sun.intensity = 1.7 * sunFactor;

  // Sun colour: warm white at noon, deep orange near horizon.
  if (sunElev > 0.28) sun.color.setHex(0xfff0d0);
  else if (sunElev > 0.10) {
    const t = (sunElev - 0.10) / 0.18;
    sun.color.setRGB(1.0, 0.50 + t * 0.44, 0.30 + t * 0.70);
  } else {
    sun.color.setHex(0xff6a30);
  }

  // Moon is exactly opposite the sun.
  const moonElev = -sunElev;
  const moonAzim = -sunAzim;
  const mx = moonAzim * 0.55;
  const my = Math.max(-0.20, moonElev);
  const mz = 0.35;
  const ml = Math.sqrt(mx * mx + my * my + mz * mz);

  moon.position.set((mx / ml) * 300, (my / ml) * 300, (mz / ml) * 300);
  moon.target.position.set(0, 0, 0);
  moon.target.updateMatrixWorld();

  let moonFactor;
  if      (moonElev <  0.02) moonFactor = 0;
  else if (moonElev <  0.20) moonFactor = (moonElev - 0.02) / 0.18;
  else                       moonFactor = 1;
  moon.intensity = 0.7 * moonFactor;
  moon.color.setHex(moonElev > 0.20 ? 0xb6c8ff : 0x5878b0);

  // Sky colour blends through night → dawn/dusk → day.
  const dayness = Math.max(0, sunElev);
  let sr, sg, sb;
  if (dayness > 0.45) {
    sr = 0.56; sg = 0.68; sb = 0.79;            // day
  } else if (dayness > 0.10) {
    const t = (dayness - 0.10) / 0.35;
    sr = 0.36 + t * 0.20;                       // → day
    sg = 0.36 + t * 0.32;
    sb = 0.46 + t * 0.33;
  } else if (dayness > 0.02) {
    const t = dayness / 0.10;                   // dawn / dusk
    sr = 0.08 + t * 0.28;
    sg = 0.10 + t * 0.26;
    sb = 0.18 + t * 0.28;
  } else {
    sr = 0.04; sg = 0.06; sb = 0.16;            // night
  }
  skyColor.setRGB(sr, sg, sb);
  scene.fog.color.copy(skyColor);

  // Ambient colour follows the sky but a touch cooler, intensity ramps
  // with daylight so nights aren't pitch black.
  ambient.color.setRGB(sr * 0.85, sg * 0.85, sb * 0.85);
  ambient.intensity = 0.35 + dayness * 0.55;

  // Push the lighting uniforms into the custom shaders so the terrain
  // and water light with the same scene lighting.
  const sunDirVec = sun.position.clone().normalize();
  const moonDirVec = moon.position.clone().normalize();
  const ambR = ambient.color.r * ambient.intensity * 1.6;
  const ambG = ambient.color.g * ambient.intensity * 1.6;
  const ambB = ambient.color.b * ambient.intensity * 1.6;
  terrainMat.uniforms.uLightDir.value.copy(sunDirVec);
  terrainMat.uniforms.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
  terrainMat.uniforms.uMoonDir.value.copy(moonDirVec);
  terrainMat.uniforms.uMoonColor.value.copy(moon.color).multiplyScalar(moon.intensity);
  terrainMat.uniforms.uAmbient.value.setRGB(ambR, ambG, ambB);
  waterMat.uniforms.uLightDir.value.copy(sunDirVec);
  waterMat.uniforms.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
  waterMat.uniforms.uMoonDir.value.copy(moonDirVec);
  waterMat.uniforms.uMoonColor.value.copy(moon.color).multiplyScalar(moon.intensity);
  waterMat.uniforms.uAmbient.value.setRGB(ambR, ambG, ambB);

  // Sun and moon sprite positions follow the same direction but live
  // further out, with a smooth fade so they don't pop in/out at the
  // horizon line.
  const sunSpriteDist = 480;
  sunSprite.position.set(sxN * sunSpriteDist, syN * sunSpriteDist, szN * sunSpriteDist);
  sunSprite.material.opacity = Math.min(1, Math.max(0, sunElev * 5));

  const moonSpriteDist = 460;
  moonSprite.position.set((mx / ml) * moonSpriteDist, (my / ml) * moonSpriteDist, (mz / ml) * moonSpriteDist);
  moonSprite.material.opacity = Math.min(1, Math.max(0, moonElev * 5));

  // Time-of-day label for the HUD / debug.
  let label;
  if (dayFrac < 0.21 || dayFrac >= 0.79)      label = 'Ночь';
  else if (dayFrac < 0.29)                    label = 'Рассвет';
  else if (dayFrac < 0.71)                    label = 'День';
  else                                        label = 'Закат';
  Globals.timeOfDay = label;
}

// Window resize handler.
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

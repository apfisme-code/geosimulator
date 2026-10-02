// Render layer: builds the GPU resources (textures, materials, tile meshes)
// and exposes syncTextures() / a tick that positions the tile group around
// the player on the toroidal world.

import * as THREE from 'three';
import { GRID, VOLCANO } from './constants.js';
const { N, NV, NV1, L, cellSize } = GRID;
const { ASH_LAYER_MAX } = VOLCANO;
import { State, Globals } from './state.js';

// ---------- Texture buffers ----------
const texHBuf   = new Float32Array(N * N * 4);
const texWBuf   = new Float32Array(N * N * 2);
const texAuxBuf = new Float32Array(N * N * 4);
const texVolBuf = new Float32Array(N * N * 4);
const texManBuf = new Float32Array(N * N);
const texAqBuf  = new Float32Array(N * N);

export const texH = new THREE.DataTexture(texHBuf, N, N, THREE.RGBAFormat, THREE.FloatType);
texH.minFilter = THREE.LinearFilter; texH.magFilter = THREE.LinearFilter;
texH.wrapS = THREE.RepeatWrapping;   texH.wrapT = THREE.RepeatWrapping;
texH.needsUpdate = true;

export const texW = new THREE.DataTexture(texWBuf, N, N, THREE.RGFormat, THREE.FloatType);
texW.minFilter = THREE.LinearFilter; texW.magFilter = THREE.LinearFilter;
texW.wrapS = THREE.RepeatWrapping;   texW.wrapT = THREE.RepeatWrapping;
texW.needsUpdate = true;

export const texAux = new THREE.DataTexture(texAuxBuf, N, N, THREE.RGBAFormat, THREE.FloatType);
texAux.minFilter = THREE.LinearFilter; texAux.magFilter = THREE.LinearFilter;
texAux.wrapS = THREE.RepeatWrapping;   texAux.wrapT = THREE.RepeatWrapping;
texAux.needsUpdate = true;

export const texVol = new THREE.DataTexture(texVolBuf, N, N, THREE.RGBAFormat, THREE.FloatType);
texVol.minFilter = THREE.LinearFilter; texVol.magFilter = THREE.LinearFilter;
texVol.wrapS = THREE.RepeatWrapping;   texVol.wrapT = THREE.RepeatWrapping;
texVol.needsUpdate = true;

export const texMantle = new THREE.DataTexture(texManBuf, N, N, THREE.RedFormat, THREE.FloatType);
texMantle.minFilter = THREE.LinearFilter; texMantle.magFilter = THREE.LinearFilter;
texMantle.wrapS = THREE.RepeatWrapping;   texMantle.wrapT = THREE.RepeatWrapping;
texMantle.needsUpdate = true;

export const texAq = new THREE.DataTexture(texAqBuf, N, N, THREE.RedFormat, THREE.FloatType);
texAq.minFilter = THREE.LinearFilter; texAq.magFilter = THREE.LinearFilter;
texAq.wrapS = THREE.RepeatWrapping;   texAq.wrapT = THREE.RepeatWrapping;
texAq.needsUpdate = true;

// Push current State into the GPU textures.
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
const commonVS = `
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

  varying vec3  vWorld;
  varying vec3  vNormalW;
  varying float vH;
  varying float vH1;
  varying float vW;
  varying float vSed;
  varying float vWind;
  varying float vDrainage;
  varying float vTemp;
  varying float vHum;
  varying float vHeat;
  varying float vAsh;
  varying float vIce;
  varying float vSnow;
  varying float vMantle;
  varying float vAq;

  void main() {
    vec2 uvc = uv;
    vec4 h4  = texture2D(texH, uvc);
    vec2 wt  = texture2D(texW, uvc).rg;
    vec4 aux = texture2D(texAux, uvc);
    vec4 vol = texture2D(texVol, uvc);
    float mantle = texture2D(texMantle, uvc).r;
    float aq = texture2D(texAq, uvc).r;

    float w   = wt.r;
    float t   = wt.g;
    float ice = vol.b;
    float snow= vol.a;

    float surface = h4.x + h4.y + h4.z + h4.w;

    vec3 pos = position;
    if (uWaterMix < 0.5) {
      float snowOnLand = surface > uSeaLevel ? snow : 0.0;
      pos.y = surface + snowOnLand;
    } else {
      float hasIce = step(0.02, ice);
      pos.y = uSeaLevel + hasIce * (0.08 * ice + snow);
    }

    float e = uTexel.x;
    vec4 hL = texture2D(texH, uvc - vec2(e, 0.0));
    vec4 hR = texture2D(texH, uvc + vec2(e, 0.0));
    vec4 hD = texture2D(texH, uvc - vec2(0.0, e));
    vec4 hU = texture2D(texH, uvc + vec2(0.0, e));
    float hLsum = hL.x+hL.y+hL.z+hL.w;
    float hRsum = hR.x+hR.y+hR.z+hR.w;
    float hDsum = hD.x+hD.y+hD.z+hD.w;
    float hUsum = hU.x+hU.y+hU.z+hU.w;

    float dHdx = (hRsum - hLsum) / (2.0 * uCellSize);
    float dHdz = (hUsum - hDsum) / (2.0 * uCellSize);
    vec3 nrm = normalize(vec3(-dHdx, 1.0, -dHdz));

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld   = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * nrm);
    vH   = surface;
    vH1  = h4.x;
    vW   = w;
    vSed = aux.x;
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

const terrainFS = `
  uniform vec3  uLightDir;
  uniform vec3  uAmbient;
  uniform vec3  uSunColor;
  uniform int   uOverlayMode;

  varying vec3  vWorld;
  varying vec3  vNormalW;
  varying float vH;
  varying float vH1;
  varying float vW;
  varying float vWind;
  varying float vDrainage;
  varying float vTemp;
  varying float vHum;
  varying float vHeat;
  varying float vAsh;
  varying float vIce;
  varying float vSnow;
  varying float vMantle;
  varying float vAq;

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
      if (vH1 < 0.3) col = mix(col, vec3(0.42, 0.38, 0.34),
                               smoothstep(0.3, 0.05, vH1) * 0.65);
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
    float lightFactor = (uOverlayMode == 0) ? 1.0 : 0.55;
    vec3 colOut = col * (uAmbient * lightFactor + uSunColor * diff * lightFactor + (1.0 - lightFactor) * 0.5);

    if (uOverlayMode == 0 && vHeat > 0.02) {
      vec3 lava = vec3(1.0, 0.35, 0.05);
      colOut = mix(colOut, lava, vHeat * 0.8);
      colOut += vec3(1.0, 0.45, 0.1) * vHeat * vHeat * 1.5;
    }

    gl_FragColor = vec4(colOut, 1.0);
  }
`;

const waterFS = `
  uniform vec3  uLightDir;
  uniform vec3  uAmbient;
  uniform vec3  uSunColor;
  uniform vec3  uCamera;
  uniform int   uOverlayMode;
  varying vec3  vWorld;
  varying vec3  vNormalW;
  varying float vW;
  varying float vSed;
  varying float vTemp;
  varying float vHeat;
  varying float vIce;
  varying float vSnow;
  varying float vH;
  varying float vDrainage;
  varying float vHum;
  varying float vAq;

  void main() {
    if (vW < 0.0003 && vIce < 0.02) discard;
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 L = normalize(uLightDir);
    vec3 V = normalize(uCamera - vWorld);
    vec3 Hv = normalize(L + V);
    float diff = max(dot(N, L), 0.0);

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
      gl_FragColor = vec4(col * (0.5 + diff * 0.3), 0.75);
      return;
    }

    if (vIce > 0.02) {
      vec3 iceCol = mix(vec3(0.82, 0.90, 1.0), vec3(0.94, 0.96, 1.0),
                        clamp(vIce * 0.3, 0.0, 1.0));
      if (vSnow > 0.02) iceCol = mix(iceCol, vec3(0.98, 0.99, 1.0), clamp(vSnow, 0.0, 1.0));
      float spec = pow(max(dot(N, Hv), 0.0), 120.0);
      vec3 colOut = iceCol * (uAmbient + uSunColor * diff);
      colOut += vec3(0.85, 0.92, 1.0) * spec * 0.7;
      if (vHeat > 0.02) colOut = mix(colOut, vec3(0.7, 0.35, 0.25), vHeat * 0.5);
      gl_FragColor = vec4(colOut, 1.0);
      return;
    }

    float d = clamp(vW * 4.0, 0.0, 1.0);
    vec3 base = mix(vec3(0.29, 0.62, 0.81), vec3(0.04, 0.15, 0.25), d);
    if (vTemp < 0.12) base = mix(base, vec3(0.88, 0.94, 1.0), smoothstep(0.12, 0.02, vTemp));
    if (vHeat > 0.02) base = mix(base, vec3(0.7, 0.35, 0.25), vHeat * 0.5);
    float turb = clamp(vSed / max(vW, 0.001) * 3.0, 0.0, 1.0);
    base = mix(base, vec3(0.37, 0.29, 0.18), turb * 0.4);
    float spec = pow(max(dot(N, Hv), 0.0), 140.0);
    vec3 col = base * (uAmbient * 0.7 + uSunColor * diff);
    col += vec3(0.81, 0.89, 1.0) * spec * 0.9;
    float alpha = clamp(sqrt(vW * 2.0), 0.0, 0.85);
    alpha = max(alpha, clamp(vW * 25.0, 0.0, 0.85));
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------- Renderer / scene / camera ----------
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const skyColor = new THREE.Color(0x8fadc9);
export const scene = new THREE.Scene();
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, L * 0.15, L * 0.55);

export const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, L * 2);
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x3a2a18, 0.9));
const sunDir = new THREE.Vector3(0.6, 1.0, 0.3).normalize();
const sun = new THREE.DirectionalLight(0xfff0d0, 1.4);
sun.position.copy(sunDir).multiplyScalar(200);
scene.add(sun);

// ---------- Materials ----------
export const terrainMat = new THREE.ShaderMaterial({
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
    uLightDir: { value: sunDir.clone() },
    uAmbient:  { value: new THREE.Color(0x405a80) },
    uSunColor: { value: new THREE.Color(0xfff0d0) },
  },
  vertexShader: commonVS,
  fragmentShader: terrainFS,
});

export const waterMat = new THREE.ShaderMaterial({
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
    uLightDir: { value: sunDir.clone() },
    uAmbient:  { value: new THREE.Color(0x405a80) },
    uSunColor: { value: new THREE.Color(0xfff0d0) },
    uCamera:   { value: new THREE.Vector3() },
  },
  vertexShader: commonVS,
  fragmentShader: waterFS,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// ---------- Toroidal tile group (3×3 around the player) ----------
const terrainGeo = buildGridGeometry();
export const terrainTiles = [];
export const waterTiles = [];
for (let i = -1; i <= 1; i++) {
  for (let j = -1; j <= 1; j++) {
    const mt = new THREE.Mesh(terrainGeo, terrainMat);
    mt.matrixAutoUpdate = false; mt.frustumCulled = false;
    scene.add(mt); terrainTiles.push({ mesh: mt, i, j });

    const mw = new THREE.Mesh(terrainGeo, waterMat);
    mw.matrixAutoUpdate = false; mw.frustumCulled = false;
    mw.renderOrder = 1;
    scene.add(mw); waterTiles.push({ mesh: mw, i, j });
  }
}

// Position the tiles around the player on every frame.
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

// Window resize handler.
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// HUD, slice preview and history graphs. Pure DOM/Canvas2D code —
// reads from State/Globals, doesn't write back.

import { GRID, SIM, CLIMATE, VOLCANO, OVERLAY, PLATES } from './constants.js';
const { N, cellSize, L, wrap } = GRID;
const { DRIFT_INTERVAL } = SIM;
const { ICE_TEMP, SNOW_TEMP, SEA_LEVEL_MIN, SEA_LEVEL_MAX } = CLIMATE;
const { ASH_LAYER_MAX } = VOLCANO;
const { HIST_LEN, NAMES: OVERLAY_NAMES } = OVERLAY;
const { MAX: MAX_PLATES } = PLATES;
import { State, Globals } from './state.js';
import { countActivePlates } from './plates.js';
import { player } from './player.js';

const sliceCanvas = document.getElementById('sliceCanvas');
const sliceCtx = sliceCanvas.getContext('2d');
const graphCanvas = document.getElementById('graphCanvas');
const graphCtx = graphCanvas.getContext('2d');
const hud = document.getElementById('hud');

// ---------- Slice preview (geological cross-section) ----------
export function renderSlice() {
  const Wc = sliceCanvas.width, Hc = sliceCanvas.height;
  sliceCtx.fillStyle = 'rgba(0,0,0,0.75)';
  sliceCtx.fillRect(0, 0, Wc, Hc);
  const pj = Math.floor(wrap(player.z) / cellSize) % N;
  const baseY = -60, topY = 80;
  const scaleY = Hc / (topY - baseY);
  const stepX = Wc / N;
  const ySea = Hc - (Globals.seaLevel - baseY) * scaleY;
  sliceCtx.strokeStyle = 'rgba(100,180,255,0.7)';
  sliceCtx.beginPath(); sliceCtx.moveTo(0, ySea); sliceCtx.lineTo(Wc, ySea); sliceCtx.stroke();

  for (let i = 0; i < N; i++) {
    const k = pj * N + i;
    const s = State.H1[k] + State.H2[k] + State.H3[k] + State.H4[k];
    const h1 = State.H1[k], h2 = State.H2[k], h3 = State.H3[k], h4 = Math.max(0, State.H4[k]);
    const sn = State.snowLayer[k], ic = State.iceLayer[k];
    const ySurface = Hc - (s - baseY) * scaleY;
    const y1 = ySurface + h1 * scaleY;
    const y2 = y1 + h2 * scaleY;
    const y3 = y2 + h3 * scaleY;
    const y4 = y3 + h4 * scaleY;
    sliceCtx.fillStyle = '#4a7a3a';
    sliceCtx.fillRect(i * stepX, ySurface, stepX, Math.max(0, h1 * scaleY));
    sliceCtx.fillStyle = '#9a8a6a';
    sliceCtx.fillRect(i * stepX, y1, stepX, Math.max(0, h2 * scaleY));
    sliceCtx.fillStyle = '#7a7065';
    sliceCtx.fillRect(i * stepX, y2, stepX, Math.max(0, h3 * scaleY));
    sliceCtx.fillStyle = '#4a4038';
    sliceCtx.fillRect(i * stepX, y3, stepX, Math.max(0, h4 * scaleY));
    if (ic > 0.05 && s < Globals.seaLevel) {
      const iceTop = Globals.seaLevel + 0.08 * ic + sn;
      const iceBot = Globals.seaLevel - 0.92 * ic;
      const yIT = Hc - (iceTop - baseY) * scaleY;
      const yIB = Hc - (iceBot - baseY) * scaleY;
      sliceCtx.fillStyle = 'rgba(180, 220, 255, 0.92)';
      sliceCtx.fillRect(i * stepX, yIT, stepX, Math.max(0, yIB - yIT));
    }
    if (State.W[k] > 0.005) {
      const yWT = Hc - (Globals.seaLevel - baseY) * scaleY;
      const yWB = Hc - (Globals.seaLevel - State.W[k] - baseY) * scaleY;
      sliceCtx.fillStyle = 'rgba(60, 130, 200, 0.85)';
      sliceCtx.fillRect(i * stepX, yWT, stepX, Math.max(1, yWB - yWT));
    }
    if (sn > 0.01 && s >= Globals.seaLevel) {
      const ySnowTop = ySurface - sn * scaleY;
      sliceCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      sliceCtx.fillRect(i * stepX, ySnowTop, stepX, Math.max(0, sn * scaleY));
    }
    if (State.Aq[k] > 0.05 && s >= Globals.seaLevel) {
      sliceCtx.fillStyle = 'rgba(80, 200, 230, 0.55)';
      sliceCtx.fillRect(i * stepX, ySurface, stepX, Math.max(1, State.Aq[k] * scaleY * 0.5));
    }
    if (State.lavaBonus[k] > 0.2) {
      sliceCtx.fillStyle = 'rgba(220, 80, 40, 0.7)';
      sliceCtx.fillRect(i * stepX, ySurface - 2, stepX, 2);
    }
  }

  sliceCtx.fillStyle = '#cfe';
  sliceCtx.font = '11px monospace';
  sliceCtx.fillText(`Разрез по X на z=${player.z.toFixed(1)} м  (диапазон −60..+80 м)`, 8, 14);
  const items = [
    { c: '#4a7a3a', t: 'H1' }, { c: '#9a8a6a', t: 'H2' },
    { c: '#7a7065', t: 'H3' }, { c: '#4a4038', t: 'H4' },
    { c: 'rgba(180,220,255,0.92)', t: 'лёд' },
    { c: 'rgba(60,130,200,0.85)', t: 'вода' },
    { c: 'rgba(255,255,255,0.95)', t: 'снег' },
    { c: 'rgba(80,200,230,0.55)', t: 'Aq' },
    { c: 'rgba(220,80,40,0.7)', t: 'лава' },
  ];
  let xPos = 8;
  for (const it of items) {
    sliceCtx.fillStyle = it.c;
    sliceCtx.fillRect(xPos, Hc - 16, 10, 10);
    sliceCtx.fillStyle = '#aaa';
    sliceCtx.fillText(it.t, xPos + 14, Hc - 7);
    xPos += 14 + sliceCtx.measureText(it.t).width + 10;
  }
}

// ---------- History graphs ----------
export function renderGraphs() {
  const Wc = graphCanvas.width, Hc = graphCanvas.height;
  graphCtx.fillStyle = 'rgba(0,0,0,0.75)';
  graphCtx.fillRect(0, 0, Wc, Hc);
  graphCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let x = 0; x <= 4; x++) {
    graphCtx.beginPath(); graphCtx.moveTo(x * Wc / 4, 0); graphCtx.lineTo(x * Wc / 4, Hc); graphCtx.stroke();
  }
  for (let y = 0; y <= 4; y++) {
    graphCtx.beginPath(); graphCtx.moveTo(0, y * Hc / 4); graphCtx.lineTo(Wc, y * Hc / 4); graphCtx.stroke();
  }
  const n = Globals.histCount;
  if (n < 2) {
    graphCtx.fillStyle = '#aaa';
    graphCtx.font = '12px monospace';
    graphCtx.fillText('Накапливаю данные...', 10, 20);
    return;
  }
  const H1s = Hc / 2, H2s = Hc / 2;
  const drawLine = (arr, toY, color) => {
    graphCtx.strokeStyle = color;
    graphCtx.lineWidth = 1.8;
    graphCtx.beginPath();
    for (let i = 0; i < n; i++) {
      const idx = (Globals.histHead - n + i + HIST_LEN) % HIST_LEN;
      const x = (i / (HIST_LEN - 1)) * Wc;
      const y = toY(arr[idx]);
      if (i === 0) graphCtx.moveTo(x, y); else graphCtx.lineTo(x, y);
    }
    graphCtx.stroke();
  };
  drawLine(State.histLand,   v => H1s - (v / 100) * H1s * 0.95 - 2, '#7bc47b');
  drawLine(State.histSnow,   v => H1s - (v / 100) * H1s * 0.95 - 2, '#ffffff');
  drawLine(State.histIce,    v => H1s - (v / 100) * H1s * 0.95 - 2, '#7bc4ff');
  const seaMin = SEA_LEVEL_MIN, seaMax = SEA_LEVEL_MAX;
  drawLine(State.histSea,    v => Hc - ((v - seaMin) / (seaMax - seaMin)) * H2s * 0.95 - 2, '#ff7b7b');
  drawLine(State.histPlates, v => Hc - (v / MAX_PLATES) * H2s * 0.5 - 2, '#ffcc66');
  drawLine(State.histAq,     v => Hc - (v / 2.0) * H2s * 0.4 - 2, '#66d9ff');
  graphCtx.fillStyle = '#cfe';
  graphCtx.font = '11px monospace';
  graphCtx.fillText('5 минут истории', 8, 14);
  const lastIdx = (Globals.histHead - 1 + HIST_LEN) % HIST_LEN;
  const lastLand   = State.histLand[lastIdx];
  const lastSnow   = State.histSnow[lastIdx];
  const lastIce    = State.histIce[lastIdx];
  const lastSea    = State.histSea[lastIdx];
  const lastPlates = State.histPlates[lastIdx];
  const lastAq     = State.histAq[lastIdx];
  graphCtx.fillText(
    `${lastLand.toFixed(0)}%  суша  ` +
    `${lastSnow.toFixed(0)}%  снег  ` +
    `${lastIce.toFixed(0)}%  лёд`, 8, 28);
  graphCtx.fillText(
    `sea: ${lastSea.toFixed(1)} м  ` +
    `плит: ${lastPlates.toFixed(0)}  ` +
    `Aq: ${lastAq.toFixed(2)} м`, 8, Hc - 8);
}

// ---------- HUD ----------
export function updateHUD() {
  const activePlates = countActivePlates();
  const lastEruptAgo = Globals.lastEruption.t > 0 ? (Globals.simTime - Globals.lastEruption.t).toFixed(0) : '—';
  const stats = Globals.stats;
  const overlayName = OVERLAY_NAMES[Globals.overlayMode] ?? '—';
  hud.textContent =
    `x=${player.x.toFixed(1)}  z=${player.z.toFixed(1)}  y=${Globals.feetY.toFixed(2)}\n` +
    `t=${Globals.simTime.toFixed(1)}с  ${Globals.paused ? 'ПАУЗА' : 'идёт'}  seed=${Globals.worldSeed}\n` +
    `биом: ${biomeAtPlayer()}  |  seaLevel=${Globals.seaLevel.toFixed(2)} м\n` +
    `плит: ${activePlates}/${MAX_PLATES}  рожд. ${Globals.birthsTotal}  смерт. ${Globals.deathsTotal}\n` +
    `плюмов: ${Globals.plumes.length}  извержений: ${Globals.eruptionsTotal}  последнее: ${lastEruptAgo}с назад${Globals.lastEruption.underwater ? ' (подводное)' : ''}\n` +
    `overlay: ${overlayName} (L)  |  разрез: ${Globals.showSlice ? 'вкл' : 'выкл'} (X)  |  графики: ${Globals.showGraphs ? 'вкл' : 'выкл'} (Y)\n` +
    `дрейф ${(DRIFT_INTERVAL / 30).toFixed(0)}с  |  суша ${stats[7].toFixed(1)}%  снег ${stats[8].toFixed(1)}%  лёд ${stats[13].toFixed(1)}%\n` +
    `лёд ср. толщ: ${stats[14].toFixed(2)} м  |  Aq ср.: ${stats[15].toFixed(2)} м\n` +
    `рельеф ${stats[0].toFixed(1)}…${stats[1].toFixed(1)} м  T=${stats[11].toFixed(2)}  H=${stats[12].toFixed(2)}\n` +
    `ср. слои H1..H4: ${stats[2].toFixed(2)} / ${stats[3].toFixed(2)} / ${stats[4].toFixed(2)} / ${stats[5].toFixed(2)}\n` +
    `вода ${stats[6].toFixed(3)}  водосбор ср./макс: ${stats[9].toFixed(1)} / ${stats[10].toFixed(0)}\n` +
    `зажимов<0: ${Globals.simClampViolations}`;
}

function biomeAtPlayer() {
  try {
    const pi = Math.floor(wrap(player.x) / cellSize) % N;
    const pj = Math.floor(wrap(player.z) / cellSize) % N;
    const pk = pj * N + pi;
    const t = State.temperature[pk];
    const h = State.humidity[pk];
    const surf = State.H1[pk] + State.H2[pk] + State.H3[pk] + State.H4[pk];
    if (surf < Globals.seaLevel) {
      if (State.iceLayer[pk] > 0.2) return 'Морской лёд';
      else return t < ICE_TEMP ? 'Ледяной океан' : 'Океан';
    }
    if (State.eruptHeat[pk] > 0.3) return 'Активный вулкан';
    if (State.lavaBonus[pk] > 0.5) return 'Лавовое поле';
    if (State.ashLayer[pk] > 0.5) return 'Пепелище';
    if (State.snowLayer[pk] > 0.3) return 'Снежное плато';
    if (State.Aq[pk] > 0.7 && State.W[pk] > 0.05) return 'Заболоченная низина';
    if (t < SNOW_TEMP && h < 0.4) return 'Тундра';
    if (t < SNOW_TEMP) return 'Полярная пустыня';
    if (t < 0.30 && h < 0.4) return 'Холодная степь';
    if (t < 0.30) return 'Тайга';
    if (t < 0.60 && h < 0.30) return 'Степь';
    if (t < 0.60 && h < 0.70) return 'Умеренный лес';
    if (t < 0.60) return 'Умеренный дождевой лес';
    if (h < 0.30) return 'Пустыня';
    if (h < 0.70) return 'Саванна';
    return 'Тропический лес';
  } catch (e) { return '—'; }
}

// ---------- Periodic stats + history sampling ----------
let lastHistoryUpdate = 0;
let lastStatsUpdate = 0;

export function periodicUI(now) {
  if (now - lastHistoryUpdate >= 1000) {
    sampleHistory();
    lastHistoryUpdate = now;
  }
  if (now - lastStatsUpdate >= 400) {
    sampleStats();
    lastStatsUpdate = now;
  }
}

function sampleHistory() {
  let landCount = 0, snowCount = 0, iceCount = 0, aqSum = 0;
  for (let k = 0; k < N * N; k++) {
    const s = State.H1[k] + State.H2[k] + State.H3[k] + State.H4[k];
    if (s > Globals.seaLevel) { landCount++; aqSum += State.Aq[k]; }
    if (State.snowLayer[k] > 0.1) snowCount++;
    if (State.iceLayer[k] > 0.1) iceCount++;
  }
  State.histLand[Globals.histHead]   = landCount / (N * N) * 100;
  State.histSnow[Globals.histHead]   = snowCount / (N * N) * 100;
  State.histIce[Globals.histHead]    = iceCount  / (N * N) * 100;
  State.histSea[Globals.histHead]    = Globals.seaLevel;
  State.histPlates[Globals.histHead] = countActivePlates();
  State.histAq[Globals.histHead]     = landCount > 0 ? aqSum / landCount : 0;
  Globals.histHead  = (Globals.histHead + 1) % HIST_LEN;
  Globals.histCount = Math.min(Globals.histCount + 1, HIST_LEN);
}

function sampleStats() {
  let mn = Infinity, mx = -Infinity;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, sw = 0, fa = 0, faMax = 0;
  let tAvg = 0, hAvg = 0;
  let land = 0, snowCells = 0, iceCells = 0, iceTotal = 0, aqSum = 0, aqMax = 0, lavaSum = 0;
  for (let k = 0; k < N * N; k++) {
    const h = State.H1[k] + State.H2[k] + State.H3[k] + State.H4[k];
    if (h < mn) mn = h; if (h > mx) mx = h;
    s1 += State.H1[k]; s2 += State.H2[k]; s3 += State.H3[k]; s4 += State.H4[k];
    sw += State.W[k];
    fa += State.flowAccumRouting[k];
    if (State.flowAccumRouting[k] > faMax) faMax = State.flowAccumRouting[k];
    tAvg += State.temperature[k];
    hAvg += State.humidity[k];
    if (h > Globals.seaLevel) { land++; aqSum += State.Aq[k]; }
    if (State.Aq[k] > aqMax) aqMax = State.Aq[k];
    if (State.snowLayer[k] > 0.1) snowCells++;
    if (State.iceLayer[k] > 0.1)  { iceCells++; iceTotal += State.iceLayer[k]; }
    lavaSum += State.lavaBonus[k];
  }
  const K = N * N;
  Globals.stats = [
    mn, mx, s1 / K, s2 / K, s3 / K, s4 / K, sw / K,
    land / K * 100,
    snowCells / K * 100,
    fa / K, faMax, tAvg / K, hAvg / K,
    iceCells / K * 100,
    (iceTotal > 0 ? iceTotal / Math.max(1, iceCells) : 0),
    (land > 0 ? aqSum / land : 0)
  ];
  window.__lavaSum = lavaSum;
}

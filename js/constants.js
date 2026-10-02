// Constants are grouped into namespace objects by subsystem.
// Modules import the namespace they need and destructure the fields
// they actually use at the top of the file. This keeps cross-cutting
// tunables together and avoids giant flat import lines.

// ---------- Grid geometry & math helpers ----------
const wrap    = v => v - Math.floor(v / 320) * 320;
const wrapRel = v => v - 320 * Math.round(v / 320);
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const DIRS = [
  [ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
  [ 1,  1], [-1,  1], [ 1, -1], [-1, -1]
];
export const GRID = {
  L: 320, N: 128, cellSize: 320 / 128, TAU: Math.PI * 2,
  SUBDIV: 8, NV: 128 * 8, NV1: 128 * 8 + 1,
  wrap, wrapRel, smoothstep, DIRS,
  TALUS: [0.35, 0.90, 1.50, 2.60],
};

// ---------- Simulation tick intervals (how often each step runs) ----------
export const SIM = {
  DRIFT_INTERVAL:        60,
  ADVECT_INTERVAL:        5,
  FLOW_ROUTING_INTERVAL: 15,
  CLIMATE_INTERVAL:      30,
  AQ_FLOW_INTERVAL:       4,
};

// ---------- Climate: humidity, rain shadow, temperature, sea level ----------
export const CLIMATE = {
  HUMIDITY_FALLOFF:    15,
  TEMP_ALT_LAPSE:      0.7,
  SEASON_AMP:          40,
  SEASON_PERIOD:       300,
  SEASON_RATE:         Math.PI * 2 / 300,
  SNOW_TEMP:           0.22,
  ICE_TEMP:            0.12,
  MELT_BAND_T:         0.08,
  SHADOW_STEPS:        24,
  SHADOW_K:            14,
  OCEAN_CURRENT_RANGE: 10,
  COLD_CURRENT:        -0.15,
  WARM_CURRENT:        +0.10,
  SEA_TEMP_GAIN:       100,
  SEA_SMOOTH:          0.05,
  T_REF_ALPHA:         0.001,
  SEA_LEVEL_MIN:       -25,
  SEA_LEVEL_MAX:         8,
};

// ---------- Snow, ice, aquifers ----------
export const ICE = {
  SNOW_MAX:          3.0,
  ICE_MAX_LAYER:     4.0,
  ICE_FORM_RATE:     0.006,
  ICE_MELT_RATE:     0.010,
  SNOW_COMPACT_RATE: 0.0005,
  SNOW_TO_ICE_RATIO: 0.4,
  ICE_FREEBORD_RATIO: 0.08,
  ICE_ACCUM:         0.012,
  MELT_RATE:         0.020,
  AQ_MAX:            2.0,
  INFIL_RATE:        0.15,
  BASEFLOW_RATE:     0.008,
  MELT_TO_W:         0.7,
  MELT_TO_AQ:        0.3,
  AQ_FLOW:           0.05,
};

// ---------- Erosion ----------
export const EROSION = {
  SLIDE_K:       0.5,
  DIFF_K:        0.35,
  RAIN_BASE:     0.010,
  RAIN_VAR:      0.012,
  EVAP:          0.025,
  K_FLOW:        0.8,
  K_CAP:         4.0,
  K_ERODE:       1.2,
  K_ERODE_ROCK:  0.06,
  K_DEPOSIT:     0.30,
  MAX_ERODE:     0.02,
  K_RIVER_ERODE: 0.0015,
};

// ---------- Wind ----------
export const WIND = {
  SPEED:         3.0,
  CAP_BASE:      0.002,
  CAP_SLOPE:     0.04,
  K_ERODE:       1.5,
  K_DEPOSIT:     0.6,
  MAX_ERODE:     0.002,
};

// ---------- Lakes ----------
export const LAKES = {
  FILL_RATE:  0.4,
  DRAIN_RATE: 0.4,
};

// ---------- Hydrology: routing, spill, water/Aq flow ----------
export const HYDROLOGY = {
  FILL_EPS:              0.05,
  K_DRAIN_ROUTING:       0.005,
  NBUCKETS:              512,
};

// ---------- Plates, mantle, Worley-driven target surface ----------
export const PLATES = {
  MANTLE_RATE:      0.03,
  MANTLE_DRIFT:     0.04,
  COUNT:            16,
  MAX:              32,
  OCEAN_FRACTION:   0.6,
  MIN_PLATE_AREA:   40,
  SPLIT_AREA_MIN:   300,
  SPLIT_PROB:       0.0008,
  SPLIT_MANTLE_MIN: 0.35,
  SPLIT_OFFSET_MIN: 8,
  SPLIT_OFFSET_MAX: 23,
  BLEND_WIDTH:      55,
  RIDGE_WIDTH:      28,
  CONT_TARGET_MIN:    4,
  CONT_TARGET_MAX:   30,
  OCEAN_TARGET_MIN: -50,
  OCEAN_TARGET_MAX: -25,
  RIDGE_MAX:        45,
  RIFT_MAX:         25,
  TRENCH_MAX:       50,
  ARC_MAX:          35,
  ARC_OFFSET:       60,
  ARC_SIG:          30,
  TRENCH_SIG:       18,
  MID_RIDGE_MAX:    22,
  AXIAL_RIFT_MAX:   10,
  VN_SCALE:         0.15,
  VN_THRESHOLD:     0.15,
  RELAX_K:          0.010,
  DETAIL_AMP:        3,
  DETAIL_FREQ:       2.5,
  DETAIL_OCT:        5,
  PLATEAU_MAX:      10,
  PLATEAU_OFFSET:   40,
  PLATEAU_SIG:      22,
};

// ---------- Volcanoes ----------
export const VOLCANO = {
  PLUME_COUNT:     12,
  ERUPT_MIN:       400,
  ERUPT_MAX:       1200,
  CRATER_SIG:       5,
  CRATER_REACH:    15,
  LAVA_VOLUME:     3.0,
  HEAT_RADIUS:      6,
  HEAT_AMOUNT:      0.5,
  HEAT_DECAY:       0.998,
  ASH_SIG:         12,
  ASH_VOLUME:      0.35,
  ASH_LAYER_MAX:    2.0,
};

// ---------- Overlay, history rings ----------
export const OVERLAY = {
  COUNT: 9,
  NAMES: [
    'Биомы', 'Высота', 'Температура', 'Влажность',
    'Водосбор', 'Снег', 'Лёд', 'Тектоника', 'Грунтовые воды'
  ],
  HIST_LEN: 300,
};

// ---------- Player ----------
export const PLAYER = {
  EYE:        1.7,
  GRAVITY:    24,
  JUMP_V:      9,
  SPEED_WALK:  9,
  SPEED_RUN:  16,
};

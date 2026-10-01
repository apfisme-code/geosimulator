// Geometric / world constants
export const L = 320;
export const N = 128;
export const cellSize = L / N;
export const TAU = Math.PI * 2;

// Mesh subdivision for the rendered terrain
export const SUBDIV = 8;
export const NV = N * SUBDIV;
export const NV1 = NV + 1;

// Math helpers used everywhere — exported so consumers don't redefine them
export const wrap    = v => v - Math.floor(v / L) * L;
export const wrapRel = v => v - L * Math.round(v / L);
export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 4-neighborhood (N/S/E/W) + diagonals
export const DIRS = [
  [ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
  [ 1,  1], [-1,  1], [ 1, -1], [-1, -1]
];

// Per-layer talus angles (H1..H4)
export const TALUS = [0.35, 0.90, 1.50, 2.60];

// ============================================================
// CLIMATE / SNOW / ICE
// ============================================================
export const CLIMATE_INTERVAL  = 30;
export const HUMIDITY_FALLOFF  = 15;
export const TEMP_ALT_LAPSE    = 0.7;
export const SEASON_AMP        = 40;
export const SEASON_PERIOD     = 300;
export const SEASON_RATE       = TAU / SEASON_PERIOD;
export const SNOW_TEMP         = 0.22;
export const ICE_TEMP          = 0.12;
export const MELT_BAND_T       = 0.08;
export const SHADOW_STEPS      = 24;
export const SHADOW_K          = 14;
export const OCEAN_CURRENT_RANGE = 10;
export const COLD_CURRENT      = -0.15;
export const WARM_CURRENT      = +0.10;
export const SEA_TEMP_GAIN     = 100;
export const SEA_SMOOTH        = 0.05;
export const T_REF_ALPHA       = 0.001;
export const SEA_LEVEL_MIN     = -25;
export const SEA_LEVEL_MAX     = 8;
export const SNOW_MAX          = 3.0;
export const ICE_MAX_LAYER     = 4.0;
export const ICE_FORM_RATE     = 0.006;
export const ICE_MELT_RATE     = 0.010;
export const SNOW_COMPACT_RATE = 0.0005;
export const SNOW_TO_ICE_RATIO = 0.4;
export const ICE_FREEBORD_RATIO = 0.08;
export const ICE_ACCUM         = 0.012;
export const MELT_RATE         = 0.020;
export const AQ_MAX            = 2.0;
export const INFIL_RATE        = 0.15;
export const BASEFLOW_RATE     = 0.008;
export const MELT_TO_W         = 0.7;
export const MELT_TO_AQ        = 0.3;
export const AQ_FLOW           = 0.05;
export const AQ_FLOW_INTERVAL  = 4;
export const K_RIVER_ERODE     = 0.0015;

// ============================================================
// EROSION
// ============================================================
export const SLIDE_K           = 0.5;
export const DIFF_K            = 0.35;
export const RAIN_BASE         = 0.010;
export const RAIN_VAR          = 0.012;
export const EVAP              = 0.025;
export const K_FLOW            = 0.8;
export const K_CAP             = 4.0;
export const K_ERODE           = 1.2;
export const K_ERODE_ROCK      = 0.06;
export const K_DEPOSIT         = 0.30;
export const MAX_ERODE         = 0.02;

// ============================================================
// WIND
// ============================================================
export const WIND_SPEED        = 3.0;
export const WIND_CAP_BASE     = 0.002;
export const WIND_CAP_SLOPE    = 0.04;
export const K_WIND_ERODE      = 1.5;
export const K_WIND_DEPOSIT    = 0.6;
export const MAX_WIND_ERODE    = 0.002;

// ============================================================
// LAKES
// ============================================================
export const LAKE_FILL_RATE    = 0.4;
export const LAKE_DRAIN_RATE   = 0.4;

// ============================================================
// HYDROLOGY
// ============================================================
export const FILL_EPS              = 0.05;
export const FLOW_ROUTING_INTERVAL = 15;
export const K_DRAIN_ROUTING       = 0.005;
export const NBUCKETS              = 512;
export const ADVECT_INTERVAL       = 5;

// ============================================================
// PLATES / MANTLE
// ============================================================
export const MANTLE_RATE      = 0.03;
export const MANTLE_DRIFT     = 0.04;
export const PLATE_COUNT      = 16;
export const MAX_PLATES       = 32;
export const OCEAN_FRACTION   = 0.6;
export const DRIFT_INTERVAL   = 60;
export const MIN_PLATE_AREA   = 40;
export const SPLIT_AREA_MIN   = 300;
export const SPLIT_PROB       = 0.0008;
export const SPLIT_MANTLE_MIN = 0.35;
export const SPLIT_OFFSET_MIN = 8;
export const SPLIT_OFFSET_MAX = 23;
export const BLEND_WIDTH      = 55;
export const RIDGE_WIDTH      = 28;
export const CONT_TARGET_MIN  =   4;
export const CONT_TARGET_MAX  =  30;
export const OCEAN_TARGET_MIN = -50;
export const OCEAN_TARGET_MAX = -25;
export const RIDGE_MAX        = 45;
export const RIFT_MAX         = 25;
export const TRENCH_MAX       = 50;
export const ARC_MAX          = 35;
export const ARC_OFFSET       = 60;
export const ARC_SIG          = 30;
export const TRENCH_SIG       = 18;
export const MID_RIDGE_MAX    = 22;
export const AXIAL_RIFT_MAX   = 10;
export const PLATE_VN_SCALE   = 0.15;
export const VN_THRESHOLD     = 0.15;
export const RELAX_K          = 0.010;
export const DETAIL_AMP       = 3;
export const DETAIL_FREQ      = 2.5;
export const DETAIL_OCT       = 5;
export const PLATEAU_MAX      = 10;
export const PLATEAU_OFFSET   = 40;
export const PLATEAU_SIG      = 22;

// ============================================================
// VOLCANOES
// ============================================================
export const PLUME_COUNT      = 12;
export const PLUME_ERUPT_MIN  = 400;
export const PLUME_ERUPT_MAX  = 1200;
export const CRATER_SIG       = 5;
export const CRATER_REACH     = 15;
export const LAVA_VOLUME      = 3.0;
export const HEAT_RADIUS      = 6;
export const HEAT_AMOUNT      = 0.5;
export const HEAT_DECAY       = 0.998;
export const ASH_SIG          = 12;
export const ASH_VOLUME       = 0.35;
export const ASH_LAYER_MAX    = 2.0;

// ============================================================
// OVERLAY / HISTORY / PLAYER
// ============================================================
export const OVERLAY_COUNT = 9;
export const OVERLAY_NAMES = [
  'Биомы', 'Высота', 'Температура', 'Влажность',
  'Водосбор', 'Снег', 'Лёд', 'Тектоника', 'Грунтовые воды'
];
export const HIST_LEN     = 300;
export const EYE          = 1.7;
export const GRAVITY      = 24;
export const JUMP_V       = 9;
export const SPEED_WALK   = 9;
export const SPEED_RUN    = 16;

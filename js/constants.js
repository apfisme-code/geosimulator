// Constants are grouped into namespace objects by subsystem.
// Modules import the namespace they need and destructure the fields
// they actually use at the top of the file. This keeps cross-cutting
// tunables together and avoids giant flat import lines.

// ---------- Grid geometry & math helpers ----------
/** Wrap an absolute position into [0, L). Used for long-running drift. */
const wrap    = v => v - Math.floor(v / 320) * 320;
/** Wrap a delta into (-L/2, L/2]. Used for inter-cell distances. */
const wrapRel = v => v - 320 * Math.round(v / 320);
/** Smoothstep — classic GLSL smoothstep with cubic Hermite edges. */
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Eight D8 neighbour offsets: [+x, -x, +z, -z, +x+z, -x+z, +x-z, -x-z]. */
const DIRS = [
  [ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
  [ 1,  1], [-1,  1], [ 1, -1], [-1, -1]
];
/**
 * Grid geometry + math helpers.
 * @property {number} L          World side length in world units (320).
 * @property {number} N          Grid resolution per axis (128 cells).
 * @property {number} cellSize    World units per cell (L/N = 2.5).
 * @property {number} TAU         2π, used by trig-based coordinate mappings.
 * @property {number} SUBDIV      Tile mesh subdivisions per cell (8).
 * @property {number} NV          Per-tile grid resolution (N * SUBDIV = 1024).
 * @property {number} NV1         Per-tile vertex count per axis (NV + 1).
 * @property {(v:number) => number} wrap        Wrap absolute position into [0, L).
 * @property {(v:number) => number} wrapRel     Wrap delta into (-L/2, L/2].
 * @property {(a:number, b:number, x:number) => number} smoothstep Cubic Hermite smoothstep.
 * @property {number[][]} DIRS    D8 neighbour offset table.
 * @property {number[]} TALUS     Maximum slope per soil/gravel/soft-rock/hard-rock layer
 *                                 before talus sliding kicks in.
 */
export const GRID = {
  L: 320, N: 128, cellSize: 320 / 128, TAU: Math.PI * 2,
  SUBDIV: 8, NV: 128 * 8, NV1: 128 * 8 + 1,
  wrap, wrapRel, smoothstep, DIRS,
  TALUS: [0.35, 0.90, 1.50, 2.60],
};

// ---------- Simulation tick intervals (how often each step runs) ----------
/**
 * How often each slow-tick pipeline step runs (in `simulate()` calls).
 * A step is run iff `(simStepCount % INTERVAL) === 0`. Steps with
 * `null` in `STEPS.every` run every tick.
 * @property {number} DRIFT_INTERVAL        Tectonic plate drift + lifecycle.
 * @property {number} ADVECT_INTERVAL       Plate-frame advection of H1..H4 + lavaBonus.
 * @property {number} FLOW_ROUTING_INTERVAL Depression fill + D8 routing.
 * @property {number} CLIMATE_INTERVAL      Humidity, temperature, sea level.
 * @property {number} AQ_FLOW_INTERVAL      Subsurface aquifer advection.
 */
export const SIM = {
  DRIFT_INTERVAL:        60,
  ADVECT_INTERVAL:        5,
  FLOW_ROUTING_INTERVAL: 15,
  CLIMATE_INTERVAL:      30,
  AQ_FLOW_INTERVAL:       4,
};

// ---------- Climate: humidity, rain shadow, temperature, sea level ----------
/**
 * Climate tunables: humidity distance falloff, temperature lapse rate
 * with altitude, seasonal swing, rain-shadow max-barrier, ocean current
 * temperatures near west/east coasts, and the global sea-level model.
 * @property {number} HUMIDITY_FALLOFF     Distance (cells) over which humidity decays.
 * @property {number} TEMP_ALT_LAPSE       Temperature drop per unit altitude.
 * @property {number} SEASON_AMP           Seasonal latitude shift amplitude (world units).
 * @property {number} SEASON_PERIOD        Period of the seasonal cycle (seconds).
 * @property {number} SEASON_RATE          Angular frequency of the seasonal cycle.
 * @property {number} SNOW_TEMP            Below this, snow can accumulate.
 * @property {number} ICE_TEMP             Below this, sea ice forms.
 * @property {number} MELT_BAND_T          Temperature band above SNOW_TEMP where snow melts.
 * @property {number} SHADOW_STEPS         Upwind steps to scan for the rain-shadow barrier.
 * @property {number} SHADOW_K             Barrier height (m) that halves humidity.
 * @property {number} OCEAN_CURRENT_RANGE  Steps to scan along the row for west/east land.
 * @property {number} COLD_CURRENT         Cold current delta near west coasts.
 * @property {number} WARM_CURRENT         Warm current delta near east coasts.
 * @property {number} SEA_TEMP_GAIN        Sea level drop per unit of warming.
 * @property {number} SEA_SMOOTH           Smoothing factor for sea level change.
 * @property {number} T_REF_ALPHA          Slow EMA factor for the global temperature baseline.
 * @property {number} SEA_LEVEL_MIN        Hard lower bound for sea level.
 * @property {number} SEA_LEVEL_MAX        Hard upper bound for sea level.
 */
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
/**
 * Snow / sea-ice / aquifer tunables.
 * @property {number} SNOW_MAX            Max snow thickness per cell.
 * @property {number} ICE_MAX_LAYER       Max sea-ice thickness per cell.
 * @property {number} ICE_FORM_RATE       Sea-ice formation rate (per second per coldFactor).
 * @property {number} ICE_MELT_RATE       Sea-ice melt rate.
 * @property {number} SNOW_COMPACT_RATE    Snow→ice compaction rate.
 * @property {number} SNOW_TO_ICE_RATIO   Fraction of compacted snow that becomes ice.
 * @property {number} ICE_FREEBORD_RATIO  Freeboard above sea level per unit ice.
 * @property {number} ICE_ACCUM           Snow accumulation rate on land/ice.
 * @property {number} MELT_RATE           Snow melt rate (when above melt band).
 * @property {number} AQ_MAX              Max aquifer depth per cell.
 * @property {number} INFIL_RATE          Soil infiltration rate constant.
 * @property {number} BASEFLOW_RATE       Aquifer baseflow rate.
 * @property {number} MELT_TO_W           Fraction of meltwater that becomes surface water.
 * @property {number} MELT_TO_AQ          Fraction of meltwater that becomes aquifer.
 * @property {number} AQ_FLOW             Aquifer advection rate constant.
 */
export const ICE = {
  SNOW_MAX:          3.0,
  ICE_MAX_LAYER:     4.0,
  ICE_FORM_RATE:     0.025,
  ICE_MELT_RATE:     0.010,
  SNOW_COMPACT_RATE: 0.0005,
  SNOW_TO_ICE_RATIO: 0.4,
  ICE_FREEBORD_RATIO: 0.08,
  ICE_ACCUM:         0.045,
  MELT_RATE:         0.020,
  AQ_MAX:            2.0,
  INFIL_RATE:        0.15,
  BASEFLOW_RATE:     0.008,
  MELT_TO_W:         0.7,
  MELT_TO_AQ:        0.3,
  AQ_FLOW:           0.05,
};

// ---------- Erosion ----------
/**
 * Erosion tunables: talus sliding, diffusion, transport-limited river
 * erosion/deposition, evaporation.
 * @property {number} SLIDE_K       Talus sliding rate constant.
 * @property {number} DIFF_K        Top-soil (H1) diffusion rate between neighbours.
 * @property {number} RAIN_BASE     Rainfall base rate (per unit humidity).
 * @property {number} RAIN_VAR      Rainfall cloud-noise variation amplitude.
 * @property {number} EVAP          Evaporation rate (per second).
 * @property {number} K_FLOW        Surface water pair-flux rate.
 * @property {number} K_CAP         Sediment transport capacity multiplier.
 * @property {number} K_ERODE       Erosion rate multiplier.
 * @property {number} K_ERODE_ROCK  Fraction of erosion that bites into hard rock.
 * @property {number} K_DEPOSIT     Deposition rate multiplier.
 * @property {number} MAX_ERODE     Maximum erosion depth per tick.
 * @property {number} K_RIVER_ERODE River-carving rate constant (flux-driven).
 */
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
/**
 * Wind tunables: advection speed, transport-capacity, erosion and
 * deposition rates.
 * @property {number} SPEED      Wind advection speed (cells per second).
 * @property {number} CAP_BASE   Base transport capacity (baseline).
 * @property {number} CAP_SLOPE  Capacity growth with upwind slope.
 * @property {number} K_ERODE    Wind erosion rate constant.
 * @property {number} K_DEPOSIT  Wind deposition rate constant.
 * @property {number} MAX_ERODE  Maximum wind erosion depth per tick.
 */
export const WIND = {
  SPEED:         3.0,
  CAP_BASE:      0.002,
  CAP_SLOPE:     0.04,
  K_ERODE:       1.5,
  K_DEPOSIT:     0.6,
  MAX_ERODE:     0.002,
};

// ---------- Lakes ----------
/**
 * Lake fill / drain rates (per second). Used by stepEvapLakes.
 * @property {number} FILL_RATE
 * @property {number} DRAIN_RATE
 */
export const LAKES = {
  FILL_RATE:  0.4,
  DRAIN_RATE: 0.4,
};

// ---------- Hydrology: routing, spill, water/Aq flow ----------
/**
 * Hydrology routing / priority-flood spill tunables.
 * @property {number} FILL_EPS        Elevation epsilon added when filling a depression.
 * @property {number} K_DRAIN_ROUTING Upstream accumulation flux constant.
 * @property {number} NBUCKETS        Number of height buckets for the top-down flow accumulation.
 */
export const HYDROLOGY = {
  FILL_EPS:              0.05,
  K_DRAIN_ROUTING:       0.005,
  NBUCKETS:              512,
};

// ---------- Plates, mantle, Worley-driven target surface ----------
/**
 * Plate / mantle / Worley tunables. Includes initial counts, target
 * base heights for ocean/continental plates, boundary effects (ridges,
 * rifts, trenches, arcs, plateaus), drift, split, and surface blending.
 * @property {number} MANTLE_RATE       Per-cell mantle uplift rate.
 * @property {number} MANTLE_DRIFT      Angular drift of the mantle noise (rad/sec).
 * @property {number} COUNT             Number of plates spawned at init.
 * @property {number} MAX               Maximum number of plates (array sizes).
 * @property {number} OCEAN_FRACTION    Fraction of plates that are oceanic at spawn.
 * @property {number} MIN_PLATE_AREA    Below this the plate is deactivated.
 * @property {number} SPLIT_AREA_MIN    Minimum area before a plate is eligible to split.
 * @property {number} SPLIT_PROB        Per-tick probability of attempting a split.
 * @property {number} SPLIT_MANTLE_MIN  Minimum mantle value to seed the new plate.
 * @property {number} SPLIT_OFFSET_MIN  Minimum offset of new plate from parent (cells).
 * @property {number} SPLIT_OFFSET_MAX  Maximum offset of new plate from parent (cells).
 * @property {number} BLEND_WIDTH       Width of the cross-fade between two owning plates.
 * @property {number} RIDGE_WIDTH       Width of convergent/divergent boundary bump.
 * @property {number} CONT_TARGET_MIN   Lower bound for continental plate target height.
 * @property {number} CONT_TARGET_MAX   Upper bound for continental plate target height.
 * @property {number} OCEAN_TARGET_MIN  Lower bound for oceanic plate target height.
 * @property {number} OCEAN_TARGET_MAX  Upper bound for oceanic plate target height.
 * @property {number} RIDGE_MAX         Max height of continental-continental convergent ridge.
 * @property {number} RIFT_MAX          Max depth of continental-continental divergent rift.
 * @property {number} TRENCH_MAX        Max depth of oceanic-continental trench.
 * @property {number} ARC_MAX           Max height of oceanic-continental volcanic arc.
 * @property {number} ARC_OFFSET        Distance (in edge units) where the arc peaks.
 * @property {number} ARC_SIG           Gaussian sigma of the arc peak.
 * @property {number} TRENCH_SIG        Gaussian sigma of the trench minimum.
 * @property {number} MID_RIDGE_MAX     Max height of oceanic-oceanic mid-ridge.
 * @property {number} AXIAL_RIFT_MAX    Max depth of oceanic-oceanic axial rift.
 * @property {number} VN_SCALE          Normalisation scale of the relative plate velocity.
 * @property {number} VN_THRESHOLD      Below this |vn| no boundary effect is applied.
 * @property {number} RELAX_K           Relaxation rate of H4 toward targetSurface.
 * @property {number} DETAIL_AMP        Amplitude of FBM detail noise on the target surface.
 * @property {number} DETAIL_FREQ       Base frequency of the detail FBM.
 * @property {number} DETAIL_OCT        Octave count of the detail FBM.
 * @property {number} PLATEAU_MAX       Max height of the continental divergent plateau.
 * @property {number} PLATEAU_OFFSET    Offset of the plateau peak from the boundary.
 * @property {number} PLATEAU_SIG       Gaussian sigma of the plateau bump.
 */
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
/**
 * Volcano tunables: plume count, eruption timing, lava/heat/ash deposit
 * shape, ash cap.
 * @property {number} PLUME_COUNT    Number of plumes to place at world init.
 * @property {number} ERUPT_MIN      Lower bound for the inter-eruption interval (sec).
 * @property {number} ERUPT_MAX      Upper bound for the inter-eruption interval (sec).
 * @property {number} CRATER_SIG     Gaussian sigma of the lava fall-off.
 * @property {number} CRATER_REACH   Radius (cells) of the lava footprint.
 * @property {number} LAVA_VOLUME    Peak lava thickness at the centre of an eruption.
 * @property {number} HEAT_RADIUS    Radius (cells) inside which heat is deposited.
 * @property {number} HEAT_AMOUNT    Peak heat deposit at the centre of an eruption.
 * @property {number} HEAT_DECAY     Per-tick multiplicative decay of eruptHeat.
 * @property {number} ASH_SIG        Gaussian sigma of the ash fall-off.
 * @property {number} ASH_VOLUME     Peak ash thickness at the centre of an eruption.
 * @property {number} ASH_LAYER_MAX  Cap on the cumulative ash layer per cell.
 */
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
  /** Exponential solidification rate of `lavaBonus` (1/simulated-second).
   *  Cooled mass joins `H4` as permanent basalt so the active molten
   *  field stays finite across many eruptions. Half-life ≈ 46 sec. */
  COOL_RATE:        0.015,
};

// ---------- Overlay, history rings ----------
/**
 * Overlay + history ring tunables.
 * @property {number} COUNT    Number of available overlay modes.
 * @property {string[]} NAMES  Human-readable names indexed by overlay mode (0..COUNT-1).
 * @property {number} HIST_LEN Number of entries kept in the per-metric history rings.
 */
export const OVERLAY = {
  COUNT: 9,
  NAMES: [
    'Биомы', 'Высота', 'Температура', 'Влажность',
    'Водосбор', 'Снег', 'Лёд', 'Тектоника', 'Грунтовые воды'
  ],
  HIST_LEN: 300,
};

// ---------- Player ----------
/**
 * First-person player tunables.
 * @property {number} EYE         Eye height above feet.
 * @property {number} GRAVITY     Downward acceleration (world units / sec²).
 * @property {number} JUMP_V      Initial upward velocity on Space.
 * @property {number} SPEED_WALK  Walking speed (world units / sec).
 * @property {number} SPEED_RUN   Sprinting speed (world units / sec).
 */
export const PLAYER = {
  EYE:        1.7,
  GRAVITY:    24,
  JUMP_V:      9,
  SPEED_WALK:  9,
  SPEED_RUN:  16,
};

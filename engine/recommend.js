/* Hammer Recommending Index — recommendation engine (Phase 3 reference implementation)
 *
 * Pure, side-effect-free ranking of the four studied hammers for a given job,
 * built ONLY from trustworthy, VISIBLE metrics (never the legacy Injury_Risk_Index).
 * See docs/recommendation_spec.md for the derivation and worked hand-checks.
 *
 * Design goals:
 *   - Transparent: every hammer's overall strain is a weighted sum of four
 *     components the UI can show (effort, shock, fatigue, workload). No black box.
 *   - Tunable: weights and the metric->component maps are data at the top, not
 *     magic numbers buried in the math.
 *   - Honest: transmission ("shock") is only counted where it was actually
 *     measured; unmapped materials are approximated to the nearest studied
 *     surface by hardness and flagged.
 *
 * Runs in the browser (as a client-side fallback) and under Node (for tests).
 * Phase 4 ports this same math to the FastAPI backend as the source of truth.
 */

// ----- tunables (documented in the spec) -----

// Linear map endpoints: raw metric value -> 0..100 strain contribution.
// lo maps to 0 (easiest), hi maps to 100 (hardest). Chosen to bracket the
// observed range across BOTH studied surfaces so scores are comparable.
const MAPS = {
  effort:   { metric: "peak_force_n",        lo: 4.0,  hi: 7.5 },   // impact / muscle intensity
  shock:    { metric: "transmission_ratio",  lo: 0.90, hi: 1.10 },  // shock reaching the forearm
  perStrike:{ metric: "energy_per_strike_j", lo: 30,   hi: 200 },   // per-hit energy cost
};

// Component weights for the overall strain score (must describe intent, not just sum to 1).
// If "shock" is unavailable (transmission not measured), its weight is redistributed
// proportionally across the other three so the score stays on the same 0..100 scale.
const WEIGHTS = { effort: 0.30, shock: 0.15, fatigue: 0.25, workload: 0.30 };

// Cumulative load reference: a "typical" job = 30 min at ~30 strikes/min = 900 strikes -> loadFactor 1.0.
const REF_STRIKES = 900;
const CADENCE_PER_MIN = 30;      // assumed hammering cadence when strike count is unknown
const LOAD_FACTOR_RANGE = [0.2, 2.0];

const CONFIDENCE_MIN_N = 5;      // group means below this session count get a low-sample flag

// ----- helpers -----

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

// Linear map raw -> 0..100 using a MAPS entry, clamped at both ends.
function mapScore(raw, m) {
  return clamp(((raw - m.lo) / (m.hi - m.lo)) * 100);
}

// Estimated total strikes for the job: explicit count wins, else duration x cadence.
function estimateStrikes(minutes, strikes) {
  if (strikes && strikes > 0) return strikes;
  return Math.max(0, minutes) * CADENCE_PER_MIN;
}

// Cumulative load factor from estimated strikes, relative to the reference job.
function loadFactor(estStrikes) {
  return clamp(estStrikes / REF_STRIKES, LOAD_FACTOR_RANGE[0], LOAD_FACTOR_RANGE[1]);
}

// ----- core: score one hammer profile for the job -----

// Returns the four visible components (0..100) + overall strain for a single
// hammer's profile row. `lf` is the shared job load factor.
function scoreProfile(row, lf) {
  const effort = mapScore(row.peak_force_n, MAPS.effort);

  const hasShock = row.transmission_is_measured === true;
  const shock = hasShock ? mapScore(row.transmission_ratio, MAPS.shock) : null;

  const perHit = mapScore(row.energy_per_strike_j, MAPS.perStrike);
  // Fatigue grows sublinearly with job length (technique holds up a while);
  // workload is the total burden and grows linearly with it.
  const fatigue = clamp(perHit * Math.sqrt(lf));
  const workload = clamp(perHit * lf);

  // Effective weights: drop shock and renormalize if transmission wasn't measured.
  const w = { ...WEIGHTS };
  if (!hasShock) {
    const rest = w.effort + w.fatigue + w.workload;
    const share = w.shock / rest;
    w.effort += w.effort * share;
    w.fatigue += w.fatigue * share;
    w.workload += w.workload * share;
    w.shock = 0;
  }

  const overall =
    w.effort * effort +
    (hasShock ? w.shock * shock : 0) +
    w.fatigue * fatigue +
    w.workload * workload;

  return {
    components: { effort, shock, fatigue, workload },
    hasShock,
    overall: clamp(overall),
  };
}

// ----- public API -----

/**
 * Rank the four studied hammers for a job.
 *
 * @param {object} input
 *   - material: one of the app material codes (rubber|knob|plastic|wood|metal|concrete)
 *   - minutes:  time on the job (used when strikes is unknown)
 *   - strikes:  optional explicit strike count (overrides duration for load)
 *   - weightOz: optional user's own hammer weight (oz) for the "your hammer" readout
 * @param {object} data  the profiles dataset (profiles.v1.json shape)
 * @returns {object} ranked result — see docs/recommendation_spec.md
 */
function recommend(input, data) {
  const material = input.material;
  const map = data.material_map[material];
  if (!map) throw new Error(`Unknown material: ${material}`);

  const surface = map.surface;
  const table = data.profiles[surface];
  if (!table) throw new Error(`No profile data for surface: ${surface}`);

  const minutes = Number(input.minutes) || 0;
  const strikes = Math.max(0, Math.floor(Number(input.strikes) || 0));
  const estStrikes = estimateStrikes(minutes, strikes);
  const lf = loadFactor(estStrikes);

  const codes = Object.keys(table);
  const ranked = codes
    .map((code) => {
      const row = table[code];
      const scored = scoreProfile(row, lf);
      const lowSample = (row.n || 0) < CONFIDENCE_MIN_N;
      return {
        code,
        oz: data.hammers[code] ? data.hammers[code].oz : null,
        n: row.n,
        lowSample,
        components: scored.components,
        transmissionMeasured: scored.hasShock,
        overall: Math.round(scored.overall * 10) / 10,
      };
    })
    // Tie-break on mass, then code. `overall` is already rounded to 1dp, so
    // exact ties are common; without an explicit tie-break the order would fall
    // back to iteration order, and JS and Python disagree there — JS lists
    // integer-like keys ("16","20","22") before string keys ("S"), Python keeps
    // insertion order. That made the two engines pick different `best` hammers
    // for the same job. Lighter wins a tie, consistent with "least strain".
    .sort((a, b) => (a.overall - b.overall) || (a.oz - b.oz) || (a.code < b.code ? -1 : 1));

  // Confidence + honesty flags for the whole recommendation.
  const anyLowSample = ranked.some((r) => r.lowSample);
  let confidence;
  if (!map.direct) confidence = "approximate";
  else if (anyLowSample) confidence = "measured-low-sample";
  else confidence = "measured";

  const disclaimers = [];
  if (!map.direct) {
    disclaimers.push(
      `Ranked from the closest measured surface ` +
      `("${surface}") by hardness — may not be accurate for ${material}.`
    );
  }
  if (anyLowSample) {
    disclaimers.push(
      `Some hammers were measured on fewer than ${CONFIDENCE_MIN_N} sessions; treat small gaps as noise.`
    );
  }

  const result = {
    material,
    surface,
    direct: map.direct,
    confidence,
    disclaimers,
    job: { minutes, strikes, estimatedStrikes: estStrikes, loadFactor: Math.round(lf * 100) / 100 },
    ranking: ranked,
    best: ranked[0],
    formulaVersion: "engine-v1",
  };

  // Optional: interpolate the user's own hammer weight against the ranked set,
  // matching the "Your hammer" card in the current UI.
  if (input.weightOz != null && input.weightOz !== "") {
    result.yourHammer = interpolateForWeight(Number(input.weightOz), table, data, lf);
  }

  return result;
}

// Piecewise-linear interpolation of each visible component across the studied
// weights, so the user's exact hammer weight gets a plausible strain readout.
function interpolateForWeight(weightOz, table, data, lf) {
  const rows = Object.keys(table)
    .map((code) => ({ oz: data.hammers[code].oz, code, row: table[code] }))
    .sort((a, b) => a.oz - b.oz);

  const keys = ["effort", "shock", "fatigue", "workload"];
  const at = (r) => scoreProfile(r.row, lf).components;

  function interpComponent(key) {
    const w = weightOz;
    if (w <= rows[0].oz) return at(rows[0])[key];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (w <= b.oz) {
        const k = (w - a.oz) / (b.oz - a.oz);
        const va = at(a)[key], vb = at(b)[key];
        if (va == null || vb == null) return va == null ? vb : va;
        return va + (vb - va) * k;
      }
    }
    return at(rows[rows.length - 1])[key];
  }

  const components = {};
  for (const key of keys) {
    const v = interpComponent(key);
    components[key] = v == null ? null : Math.round(v * 10) / 10;
  }
  const parts = [components.effort, components.shock, components.fatigue, components.workload]
    .filter((v) => v != null);
  const overall = parts.length ? Math.round((parts.reduce((s, v) => s + v, 0) / parts.length) * 10) / 10 : null;

  return { weightOz, components, overall };
}

// Dual export: CommonJS for Node tests, global for the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { recommend, scoreProfile, mapScore, estimateStrikes, loadFactor, MAPS, WEIGHTS };
} else if (typeof window !== "undefined") {
  window.HammerEngine = { recommend };
}

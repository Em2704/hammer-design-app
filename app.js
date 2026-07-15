/* PHASE 1 MOCKUP — stub data + stub ranking only.
   Real logic comes in Phase 3 (engine) + Phase 4 (API). Numbers here are
   placeholders shaped to look plausible, NOT study output.

   Model: the study measured 4 hammer weights. The user enters any weight;
   we interpolate (and extrapolate at the ends) between the studied weights.
   NOTE: stub values rise monotonically with weight, so the lightest always
   "wins" — real data may show a sweet-spot curve instead. */

// Studied hammer weights (oz) and their model codes.
const STUDY_HAMMERS = [
  { oz: 15, code: "S" },
  { oz: 16, code: "16" },
  { oz: 20, code: "20" },
  { oz: 22, code: "22" },
];

// Lower score = easier on the body. Scale 0-100. Keyed by surface, then weight.
const STUB_METRICS = {
  knob: {
    15: { effort: 30, shock: 18, fatigue: 35, workload: 28 },
    16: { effort: 40, shock: 25, fatigue: 42, workload: 38 },
    20: { effort: 52, shock: 35, fatigue: 50, workload: 55 },
    22: { effort: 64, shock: 42, fatigue: 60, workload: 68 },
  },
  wood: {
    15: { effort: 35, shock: 30, fatigue: 40, workload: 30 },
    16: { effort: 45, shock: 45, fatigue: 45, workload: 42 },
    20: { effort: 58, shock: 60, fatigue: 55, workload: 60 },
    22: { effort: 70, shock: 72, fatigue: 65, workload: 75 },
  },
};

// User material -> studied surface. direct = we have data for it.
const MATERIAL_MAP = {
  rubber:   { surface: "knob", direct: false },
  knob:     { surface: "knob", direct: true  },
  plastic:  { surface: "knob", direct: false },
  wood:     { surface: "wood", direct: true  },
  metal:    { surface: "wood", direct: false },
  concrete: { surface: "wood", direct: false },
};

const METRIC_LABELS = {
  effort:   "Muscle effort",
  shock:    "Shock to arm",
  fatigue:  "Fatigue",
  workload: "Workload",
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const weightEl = $("weight");
const weightOut = $("weightOut");
const durationEl = $("duration");
const durationOut = $("durationOut");

weightEl.addEventListener("input", () => {
  weightOut.innerHTML = `${weightEl.value}<span class="unit">oz</span>`;
});
durationEl.addEventListener("input", () => {
  durationOut.innerHTML = `${durationEl.value}<span class="unit">min</span>`;
});

// Scrolling the page while the strikes field is focused would silently change
// its value (Chrome wheel-on-number-input behavior) — drop focus instead.
$("strikes").addEventListener("wheel", (e) => e.target.blur());

$("recommendBtn").addEventListener("click", recommend);

// ---------- helpers ----------
function clamp(v) { return Math.max(0, Math.min(100, v)); }

// Piecewise-linear interpolation across the studied weights for one metric,
// with linear extrapolation (clamped) beyond the measured range.
function interpMetric(table, weights, w, key) {
  if (w <= weights[0]) {
    const [a, b] = [weights[0], weights[1]];
    const slope = (table[b][key] - table[a][key]) / (b - a);
    return clamp(table[a][key] + slope * (w - a));
  }
  for (let i = 1; i < weights.length; i++) {
    const a = weights[i - 1], b = weights[i];
    if (w <= b) {
      const k = (w - a) / (b - a);
      return clamp(table[a][key] + (table[b][key] - table[a][key]) * k);
    }
  }
  const a = weights[weights.length - 2], b = weights[weights.length - 1];
  const slope = (table[b][key] - table[a][key]) / (b - a);
  return clamp(table[b][key] + slope * (w - b));
}

// Build the 4 strain metrics for a given weight + surface + duration factor.
function metricsFor(surface, w, durFactor) {
  const table = STUB_METRICS[surface];
  const weights = Object.keys(table).map(Number).sort((a, b) => a - b);
  const m = {};
  for (const key of Object.keys(METRIC_LABELS)) m[key] = interpMetric(table, weights, w, key);
  m.fatigue = clamp(m.fatigue * durFactor);
  m.workload = clamp(m.workload * durFactor);
  m.overall = (m.effort + m.shock + m.fatigue + m.workload) / 4;
  return m;
}

// strain heat ramp: cool teal -> green -> amber -> ember across 0..100.
const HEAT_STOPS = [
  { at: 0,   rgb: [47, 125, 142] },
  { at: 33,  rgb: [63, 158, 111] },
  { at: 66,  rgb: [194, 145, 47] },
  { at: 100, rgb: [177, 67, 47] },
];
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function strainColor(v) {
  v = clamp(v);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const lo = HEAT_STOPS[i - 1], hi = HEAT_STOPS[i];
    if (v <= hi.at) {
      const k = (v - lo.at) / (hi.at - lo.at);
      const c = [0, 1, 2].map((j) => lerp(lo.rgb[j], hi.rgb[j], k));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return `rgb(177, 67, 47)`;
}
function bandWord(v) {
  if (v < 40) return "low";
  if (v < 65) return "moderate";
  return "high";
}

function gaugesHtml(metrics) {
  return Object.keys(METRIC_LABELS).map((key) => {
    const v = Math.round(metrics[key]);
    return `
      <div class="gauge">
        <div class="gauge-top">
          <span class="g-name">${METRIC_LABELS[key]}</span>
          <span class="g-val">${String(v).padStart(2, "0")} · ${bandWord(v)}</span>
        </div>
        <div class="gauge-track">
          <div class="gauge-fill" style="width:${v}%; background:${strainColor(v)}"></div>
        </div>
      </div>`;
  }).join("");
}

// ---------- main ----------
function recommend() {
  const material = $("material").value;
  const w = Number(weightEl.value);
  const minutes = Number(durationEl.value);
  const strikes = Math.max(0, Math.floor(Number($("strikes").value) || 0));
  const map = MATERIAL_MAP[material];

  // Duration nudges fatigue + workload up (longer job = more cumulative strain).
  const durFactor = 0.8 + (minutes / 120) * 0.5; // 0.8 .. 1.3

  // Approximate strike count sharpens the cumulative estimate: more strikes,
  // more fatigue/workload. Blank (0) = neutral, duration alone drives it.
  const strikeFactor = strikes > 0 ? 0.85 + Math.min(strikes / 600, 1) * 0.45 : 1; // 0.85 .. 1.3
  const cumFactor = durFactor * strikeFactor;

  const yours = metricsFor(map.surface, w, cumFactor);

  const reference = STUDY_HAMMERS
    .map((h) => ({ ...h, metrics: metricsFor(map.surface, h.oz, cumFactor) }))
    .sort((a, b) => a.metrics.overall - b.metrics.overall);

  // Which studied weight is closest to what the user entered?
  const closestOz = STUDY_HAMMERS
    .reduce((best, h) => Math.abs(h.oz - w) < Math.abs(best - w) ? h.oz : best, STUDY_HAMMERS[0].oz);

  render({ material, map, w, strikes, yours, reference, closestOz });
}

// ---------- render ----------
function render({ material, map, w, strikes, yours, reference, closestOz }) {
  $("resultsIntro").classList.add("hidden");

  const disc = $("disclaimer");
  if (!map.direct) {
    disc.textContent =
      `No study data for “${material}”. These results are approximated from the ` +
      `closest measured surface (“${map.surface}”) and may not be accurate for ${material}.`;
    disc.classList.remove("hidden");
  } else {
    disc.classList.add("hidden");
  }

  const ov = Math.round(yours.overall);
  const yourCard = `
    <div class="your-hammer">
      <div class="yh-head">
        <span class="yh-label">Your hammer</span>
        <span class="yh-weight">${w}<span class="unit">oz</span></span>
        ${strikes > 0 ? `<span class="yh-strikes">≈${strikes} strikes</span>` : ``}
        <span class="overall">strain&nbsp;<b>${ov}</b> · ${bandWord(ov)}</span>
      </div>
      ${gaugesHtml(yours)}
    </div>`;

  const refRows = reference.map((h, i) => {
    const o = Math.round(h.metrics.overall);
    const isClosest = h.oz === closestOz;
    return `
      <li class="ref-row${i === 0 ? " best" : ""}">
        ${i === 0 ? `<span class="stamp">Best</span>` : ``}
        <span class="ref-rank">#${i + 1}</span>
        <span class="ref-name">${h.oz}<span class="unit">oz</span>
          <em class="ref-model">model ${h.code}</em></span>
        ${isClosest ? `<span class="ref-tag">≈ your weight</span>` : ``}
        <span class="ref-bar">
          <span class="ref-fill" style="width:${o}%; background:${strainColor(o)}"></span>
        </span>
        <span class="ref-val">${o}</span>
      </li>`;
  }).join("");

  $("resultsList").innerHTML = `
    ${yourCard}
    <li class="ref-heading">Reference hammers — study weights, ranked by overall strain</li>
    ${refRows}`;
}

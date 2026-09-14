/* Hammer Recommending Index — front-end controller (Phase 4).
   Rankings now come from the REAL recommendation engine (engine/recommend.js)
   run over the Phase-6C study means (engine/profiles.v1.json) — no more stubs.
   The same engine powers the FastAPI backend (backend/), so the numbers match
   whether the app runs online, offline, or against the API. This file only
   gathers the inputs, calls the engine, and draws the report. */

const METRIC_LABELS = {
  effort:   "Muscle effort",
  shock:    "Impact force",
  fatigue:  "Muscular fatigue",
  workload: "Overall workload",
};

// What the "i" beside each gauge says. Mirrors the math in engine/recommend.js
// (MAPS / WEIGHTS / loadFactor) and the measurement notes in the CISWP report
// (Force attenuation profile). Keep the three in step.
const METRIC_INFO = {
  effort:
    "Peak force at the handle per strike, in newtons: F = m × a from an accelerometer on the " +
    "hammer head and the hammer's real mass, averaged per hammer and surface across the study " +
    "group. Mapped so 4.0 N reads 0 and 7.5 N reads 100. A relative scale for comparing hammers, " +
    "not an absolute load.",
  shock:
    "How much of the strike reaches the forearm: transmission ratio = RMS forearm force ÷ RMS " +
    "hammer-head force, from accelerometers on both. 1.0 means the force passes straight through; " +
    "above 1.0 the handle amplifies it. Mapped so 0.90 reads 0 and 1.10 reads 100. Only shown where " +
    "it was actually measured — otherwise it is dropped and the other three weights are rescaled.",
  fatigue:
    "Energy the body absorbs per strike (∫|F·a| dt over the session ÷ strikes, in joules), mapped so " +
    "30 J reads 0 and 200 J reads 100, then scaled by √(load factor). Load factor = estimated strikes " +
    "÷ 900 (30 min at 30 strikes/min), limited to 0.2–2.0. Grows with job length, but slowly.",
  workload:
    "The same per-strike energy (30 J → 0, 200 J → 100) scaled linearly by the load factor " +
    "(estimated strikes ÷ 900, limited to 0.2–2.0). This is the total burden of the job: twice the " +
    "strikes, twice the workload.",
};
const OVERALL_INFO =
  "Weighted sum of the four components: 30% muscle effort + 15% impact force + 25% muscular fatigue " +
  "+ 30% overall workload, on a 0–100 scale where lower is easier on the body. When impact force was " +
  "not measured its 15% is shared out across the other three. For “Your hammer” each component is " +
  "interpolated between the two nearest studied weights and the overall is their average.";

// Circled "i" + its tooltip. `id` must be unique per page so aria-describedby resolves.
// `right` anchors the tooltip to the button's right edge — for buttons near the panel edge.
function infoHtml(id, label, text, right = false) {
  return `<span class="info-wrap${right ? " tip-right" : ""}"><button type="button" class="info" aria-label="How ${label} is calculated" aria-describedby="${id}">i</button><span id="${id}" class="info-tip" role="tooltip">${text}</span></span>`;
}

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

// ---------- engine data (loaded once, cached) ----------
// The profiles JSON is precached by the service worker, so this resolves
// offline too. Kick the load off immediately so the first click is instant.
let profilesPromise = null;
function loadProfiles() {
  if (!profilesPromise) {
    profilesPromise = fetch("./engine/profiles.v1.json").then((r) => {
      if (!r.ok) throw new Error(`profiles ${r.status}`);
      return r.json();
    });
  }
  return profilesPromise;
}
loadProfiles().catch(() => { /* surfaced on first run instead */ });

// ---------- helpers ----------
function clamp(v) { return Math.max(0, Math.min(100, v)); }

// strain heat ramp: cool teal -> green -> amber -> ember across 0..100.
// CISWP teal -> green -> amber -> ember; keep in step with --heat-* in styles.css.
const HEAT_STOPS = [
  { at: 0,   rgb: [19, 145, 135] },
  { at: 33,  rgb: [63, 158, 111] },
  { at: 66,  rgb: [224, 150, 42] },
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

// Render the four component gauges from an engine `components` object.
// `shock` can be null when transmission wasn't measured for the surface —
// show that honestly rather than a fake zero.
function gaugesHtml(components) {
  return Object.keys(METRIC_LABELS).map((key) => {
    const raw = components[key];
    const name = `${METRIC_LABELS[key]}${infoHtml(`tip-${key}`, METRIC_LABELS[key], METRIC_INFO[key])}`;
    if (raw == null) {
      return `
      <div class="gauge gauge-na">
        <div class="gauge-top">
          <span class="g-name">${name}</span>
          <span class="g-val">not measured</span>
        </div>
        <div class="gauge-track"><div class="gauge-fill" style="width:0%"></div></div>
      </div>`;
    }
    const v = Math.round(raw);
    return `
      <div class="gauge">
        <div class="gauge-top">
          <span class="g-name">${name}</span>
          <span class="g-val">${String(v).padStart(2, "0")} · ${bandWord(v)}</span>
        </div>
        <div class="gauge-track">
          <div class="gauge-fill" style="width:${v}%; background:${strainColor(v)}"></div>
        </div>
      </div>`;
  }).join("");
}

// ---------- main ----------
async function recommend() {
  const material = $("material").value;
  const w = Number(weightEl.value);
  const minutes = Number(durationEl.value);
  const strikes = Math.max(0, Math.floor(Number($("strikes").value) || 0));

  let data;
  try {
    data = await loadProfiles();
  } catch (err) {
    showError("Couldn't load the study data. Check your connection and try again.");
    return;
  }

  let res;
  try {
    res = window.HammerEngine.recommend(
      { material, minutes, strikes, weightOz: w },
      data,
    );
  } catch (err) {
    showError(`Could not compute a recommendation: ${err.message}`);
    return;
  }

  render({ res, w, strikes });
}

function showError(msg) {
  const disc = $("disclaimer");
  disc.textContent = msg;
  disc.classList.remove("hidden");
  $("resultsList").innerHTML = "";
}

// ---------- render ----------
function render({ res, w, strikes }) {
  // Honesty disclaimers straight from the engine (approximation, low sample, …).
  const disc = $("disclaimer");
  if (res.disclaimers && res.disclaimers.length) {
    disc.textContent = res.disclaimers.join(" ");
    disc.classList.remove("hidden");
  } else {
    disc.classList.add("hidden");
  }

  // "Your hammer" — interpolated to the exact weight entered.
  const yh = res.yourHammer;
  const ov = yh && yh.overall != null ? Math.round(yh.overall) : null;
  const yourCard = `
    <div class="your-hammer">
      <div class="yh-head">
        <span class="yh-label">Your hammer</span>
        <span class="yh-weight">${w}<span class="unit">oz</span></span>
        ${strikes > 0 ? `<span class="yh-strikes">≈${strikes} strikes</span>` : ``}
        ${ov != null ? `<span class="overall">strain&nbsp;<b>${ov}</b> · ${bandWord(ov)}${infoHtml("tip-overall", "overall strain", OVERALL_INFO, true)}</span>` : ``}
      </div>
      ${gaugesHtml(yh ? yh.components : {})}
    </div>`;

  // Which studied weight is closest to what the user entered?
  const closestOz = res.ranking
    .map((h) => h.oz)
    .reduce((best, oz) => (Math.abs(oz - w) < Math.abs(best - w) ? oz : best), res.ranking[0].oz);

  const refRows = res.ranking.map((h, i) => {
    const o = Math.round(h.overall);
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
    <li class="ref-heading">Reference hammers — study weights, ranked by overall strain${infoHtml("tip-ranking", "the ranking", OVERALL_INFO, true)}</li>
    ${refRows}`;
}

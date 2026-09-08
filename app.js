/* Hammer Recommending Index — front-end controller (Phase 4).
   Rankings now come from the REAL recommendation engine (engine/recommend.js)
   run over the Phase-6C study means (engine/profiles.v1.json) — no more stubs.
   The same engine powers the FastAPI backend (backend/), so the numbers match
   whether the app runs online, offline, or against the API. This file only
   gathers the inputs, calls the engine, and draws the report. */

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

// Render the four component gauges from an engine `components` object.
// `shock` can be null when transmission wasn't measured for the surface —
// show that honestly rather than a fake zero.
function gaugesHtml(components) {
  return Object.keys(METRIC_LABELS).map((key) => {
    const raw = components[key];
    if (raw == null) {
      return `
      <div class="gauge gauge-na">
        <div class="gauge-top">
          <span class="g-name">${METRIC_LABELS[key]}</span>
          <span class="g-val">not measured</span>
        </div>
        <div class="gauge-track"><div class="gauge-fill" style="width:0%"></div></div>
      </div>`;
    }
    const v = Math.round(raw);
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
  $("resultsIntro").classList.add("hidden");
  const disc = $("disclaimer");
  disc.textContent = msg;
  disc.classList.remove("hidden");
  $("resultsList").innerHTML = "";
}

// ---------- render ----------
function render({ res, w, strikes }) {
  $("resultsIntro").classList.add("hidden");

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
        ${ov != null ? `<span class="overall">strain&nbsp;<b>${ov}</b> · ${bandWord(ov)}</span>` : ``}
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
    <li class="ref-heading">Reference hammers — study weights, ranked by overall strain</li>
    ${refRows}`;
}

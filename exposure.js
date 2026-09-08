/* Hammering Exposure Tracker — front-end controller.

   Records a work shift as alternating active/rest segments and draws it as a
   square wave. This pass is timing and visuals ONLY: nothing is sent anywhere.
   "Finish day" renders the record it would submit so the shape of the payload
   is visible, but the write to hammering_risk_exposure needs the backend
   endpoint and the exposure model, which are not built yet. Deliberately: no
   score, and no claim about what an exposure level means for the body. */

const $ = (id) => document.getElementById(id);

const STORE_KEY = "hammering.exposure.shift.v1";

// ---------- state ----------
// Segments are closed in order; the last one stays open (end === null) until
// the state changes or the day is finished.
const blank = () => ({
  status: "idle",          // idle | active | rest | done
  startedAt: null,
  finishedAt: null,
  hammerOz: 16,
  hammerBrand: "",
  segments: [],            // { state: "active" | "rest", start: ms, end: ms|null }
});

let state = blank();
let ticker = null;

// ---------- persistence ----------
// A refresh mid-shift shouldn't lose the day. This is a per-browser
// convenience, not the record of truth.
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    /* private mode / storage disabled — the shift still works in memory */
  }
}

function restore() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch (err) {
    return;
  }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved && typeof saved === "object" && Array.isArray(saved.segments)) {
      state = Object.assign(blank(), saved);
    }
  } catch (err) {
    /* unreadable — start fresh rather than half-restore */
  }
}

// ---------- time helpers ----------
const segEnd = (seg, now) => (seg.end == null ? now : seg.end);

function totals(now) {
  let active = 0;
  let rest = 0;
  let bouts = 0;
  let longest = 0;
  for (const seg of state.segments) {
    const ms = Math.max(0, segEnd(seg, now) - seg.start);
    if (seg.state === "active") {
      active += ms;
      bouts += 1;
      if (ms > longest) longest = ms;
    } else {
      rest += ms;
    }
  }
  const span = active + rest;
  return { active, rest, bouts, longest, span, duty: span > 0 ? active / span : null };
}

function pad(n) { return String(n).padStart(2, "0"); }

// H:MM:SS for the shift clock.
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
}

// MM:SS under an hour, H:MM:SS over — for the compact stat tiles.
function fmtShort(ms) {
  const s = Math.floor(ms / 1000);
  if (s >= 3600) {
    return Math.floor(s / 3600) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
  }
  return pad(Math.floor(s / 60)) + ":" + pad(s % 60);
}

// ---------- transitions ----------
function openSegment(kind, now) {
  state.segments.push({ state: kind, start: now, end: null });
}

function closeSegment(now) {
  const last = state.segments[state.segments.length - 1];
  if (last && last.end == null) last.end = now;
}

function startDay() {
  const now = Date.now();
  const oz = Number($("expWeight").value);
  const brand = $("expBrand").value.trim();
  state = blank();
  state.hammerOz = oz;
  state.hammerBrand = brand;
  state.status = "active";
  state.startedAt = now;
  openSegment("active", now);
  startTicker();
  save();
  render();
}

function toggleWork() {
  if (state.status !== "active" && state.status !== "rest") return;
  const now = Date.now();
  closeSegment(now);
  state.status = state.status === "active" ? "rest" : "active";
  openSegment(state.status, now);
  save();
  render();
}

function finishDay() {
  if (state.status !== "active" && state.status !== "rest") return;
  const now = Date.now();
  closeSegment(now);
  state.status = "done";
  state.finishedAt = now;
  stopTicker();
  save();
  render();
}

function resetDay() {
  stopTicker();
  state = blank();
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (err) {
    /* nothing to clear */
  }
  $("expWeight").value = state.hammerOz;
  $("expWeightOut").innerHTML = state.hammerOz + '<span class="unit">oz</span>';
  $("expBrand").value = "";
  render();
}

function startTicker() {
  stopTicker();
  ticker = setInterval(render, 1000);
}

function stopTicker() {
  if (ticker !== null) clearInterval(ticker);
  ticker = null;
}

// ---------- chart ----------
// Geometry of the trace, in the SVG's own viewBox units.
const CH = {
  left: 96, right: 706,
  active: 60, rest: 170,   // the two lane baselines
  floor: 198,              // where the shaded active area lands
  axis: 214,               // x-axis rule
  top: 34,
};

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (text != null) node.textContent = text;
  return node;
}

// Pick a tick spacing that yields a readable number of gridlines.
function tickStep(spanMs) {
  const steps = [15e3, 30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 15 * 60e3,
                 30 * 60e3, 60 * 60e3, 2 * 60 * 60e3, 4 * 60 * 60e3];
  for (const s of steps) {
    if (spanMs / s <= 8) return s;
  }
  return steps[steps.length - 1];
}

function fmtAxis(ms) {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return Math.floor(s / 3600) + "h" + pad(Math.floor(s / 60) % 60);
  return Math.floor(s / 60) + ":" + pad(s % 60);
}

const laneY = (kind) => (kind === "active" ? CH.active : CH.rest);

function renderWave(now) {
  const svg = $("wave");
  svg.textContent = "";
  if (!state.segments.length) return;

  const t0 = state.startedAt;
  // Keep a floor on the window so a two-second-old shift isn't drawn at
  // absurd magnification.
  const last = state.segments[state.segments.length - 1];
  const span = Math.max(60e3, segEnd(last, now) - t0);
  const x = (t) => CH.left + ((t - t0) / span) * (CH.right - CH.left);

  // --- grid + x-axis (recessive) ---
  const step = tickStep(span);
  for (let t = 0; t <= span + 1; t += step) {
    const gx = x(t0 + t);
    if (gx > CH.right + 0.5) break;
    svg.appendChild(el("line", {
      x1: gx, y1: CH.top, x2: gx, y2: CH.axis, stroke: "#d3dbe2", "stroke-width": 1,
    }));
    svg.appendChild(el("text", {
      x: gx, y: CH.axis + 16, "text-anchor": "middle", class: "wave-axis",
    }, fmtAxis(t)));
  }
  svg.appendChild(el("line", {
    x1: CH.left, y1: CH.axis, x2: CH.right, y2: CH.axis,
    stroke: "#c2ccd5", "stroke-width": 1,
  }));
  svg.appendChild(el("text", {
    x: CH.right, y: CH.axis + 36, "text-anchor": "end", class: "wave-axis",
  }, "elapsed shift time"));

  // --- lane labels: identity is never colour alone ---
  ["active", "rest"].forEach((kind) => {
    svg.appendChild(el("text", {
      x: CH.left - 12, y: laneY(kind) + 4, "text-anchor": "end", class: "wave-lane",
    }, kind === "active" ? "Hammering" : "Rest"));
    svg.appendChild(el("line", {
      x1: CH.left, y1: laneY(kind), x2: CH.right, y2: laneY(kind),
      stroke: "#e3e9ee", "stroke-width": 1,
    }));
  });

  // --- shaded area under the hammering bouts: the "exposure" read ---
  state.segments.forEach((seg) => {
    if (seg.state !== "active") return;
    const x1 = x(seg.start);
    const x2 = x(segEnd(seg, now));
    svg.appendChild(el("rect", {
      x: x1, y: CH.active, width: Math.max(0.5, x2 - x1), height: CH.floor - CH.active,
      fill: "var(--exp-active)", "fill-opacity": 0.12,
    }));
  });

  // --- the square wave itself: horizontal runs + vertical transitions ---
  let prev = null;
  state.segments.forEach((seg) => {
    const y = laneY(seg.state);
    const x1 = x(seg.start);
    const x2 = x(segEnd(seg, now));
    if (prev !== null) {
      svg.appendChild(el("line", {
        x1: x1, y1: laneY(prev), x2: x1, y2: y,
        stroke: "#8b9aa8", "stroke-width": 2, "stroke-linecap": "round",
      }));
    }
    svg.appendChild(el("line", {
      x1: x1, y1: y, x2: Math.max(x1 + 0.5, x2), y2: y,
      stroke: seg.state === "active" ? "var(--exp-active)" : "var(--exp-rest)",
      "stroke-width": 4, "stroke-linecap": "round",
    }));
    prev = seg.state;
  });

  // --- live edge marker while the day is still running ---
  if (state.status === "active" || state.status === "rest") {
    svg.appendChild(el("circle", {
      cx: x(now), cy: laneY(state.status), r: 4.5,
      fill: "#f8fafb", stroke: "#16202b", "stroke-width": 2,
    }));
  }

  // --- hover targets, one per segment, full plot height ---
  state.segments.forEach((seg) => {
    const x1 = x(seg.start);
    const x2 = x(segEnd(seg, now));
    const hit = el("rect", {
      x: x1, y: CH.top, width: Math.max(2, x2 - x1), height: CH.axis - CH.top,
      fill: "transparent",
    });
    hit.addEventListener("pointerenter", (e) => showTip(e, seg, now));
    hit.addEventListener("pointerleave", hideTip);
    svg.appendChild(hit);
  });

  svg.setAttribute("aria-label", waveAlt(now));
}

function waveAlt(now) {
  const t = totals(now);
  return "Square wave of the shift: " + t.bouts + " hammering bout"
    + (t.bouts === 1 ? "" : "s") + ", " + fmtShort(t.active)
    + " hammering against " + fmtShort(t.rest) + " rest.";
}

function showTip(evt, seg, now) {
  const tip = $("waveTip");
  const dur = Math.max(0, segEnd(seg, now) - seg.start);
  const from = Math.max(0, seg.start - state.startedAt);
  tip.innerHTML = "<b>" + (seg.state === "active" ? "Hammering" : "Rest") + "</b>"
    + "<span>" + fmtShort(dur) + (seg.end == null ? " · running" : "") + "</span>"
    + "<span>from " + fmtAxis(from) + "</span>";
  tip.classList.remove("hidden");
  const wrap = $("wave").parentElement.getBoundingClientRect();
  const box = evt.target.getBoundingClientRect();
  tip.style.left = (box.left + box.width / 2 - wrap.left) + "px";
  tip.style.top = (box.top - wrap.top) + "px";
}

function hideTip() {
  $("waveTip").classList.add("hidden");
}

// ---------- summary + the record this WOULD submit ----------
function renderSummary(now) {
  const box = $("expSummary");
  if (state.status !== "done") {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const t = totals(now);
  const record = {
    hammer_weight_oz: state.hammerOz,
    hammer_brand: state.hammerBrand || null,
    shift_started_at: new Date(state.startedAt).toISOString(),
    shift_ended_at: new Date(state.finishedAt).toISOString(),
    active_seconds: Math.round(t.active / 1000),
    rest_seconds: Math.round(t.rest / 1000),
    bout_count: t.bouts,
    duty_cycle_pct: t.duty == null ? null : Math.round(t.duty * 1000) / 10,
    longest_active_bout_seconds: Math.round(t.longest / 1000),
    segments: state.segments.map((s) => ({
      state: s.state,
      start_offset_s: Math.round((s.start - state.startedAt) / 1000),
      duration_s: Math.round((segEnd(s, now) - s.start) / 1000),
    })),
  };

  const brandBit = state.hammerBrand ? " · " + escapeHtml(state.hammerBrand) : "";
  box.innerHTML = ''
    + '<div class="summary-head">'
    + '<span class="stamp">Day closed</span>'
    + '<span class="summary-title">Shift summary</span>'
    + '<span class="summary-hammer">' + state.hammerOz
    + '<span class="unit">oz</span>' + brandBit + '</span>'
    + '</div>'
    + '<dl class="summary-grid">'
    + '<div><dt>Hammering</dt><dd>' + fmtShort(t.active) + '</dd></div>'
    + '<div><dt>Rest</dt><dd>' + fmtShort(t.rest) + '</dd></div>'
    + '<div><dt>Longest bout</dt><dd>' + fmtShort(t.longest) + '</dd></div>'
    + '<div><dt>Duty cycle</dt><dd>'
    + (t.duty == null ? "—" : Math.round(t.duty * 100) + "%") + '</dd></div>'
    + '</dl>'
    + '<p class="summary-note">Timing only. No exposure score is calculated yet — that '
    + 'needs the exposure model, and saying what these numbers mean for the body '
    + 'before it exists would be a guess.</p>'
    + '<details class="record-preview">'
    + '<summary>Record this would submit</summary>'
    + '<pre>' + escapeHtml(JSON.stringify(record, null, 2)) + '</pre>'
    // TODO: POST to the backend, which writes hammering_risk_exposure. The
    // table, the endpoint and the exposure model are all still to be built.
    + '<p class="hint">Nothing is sent anywhere yet. This is the payload shape only.</p>'
    + '</details>'
    + '<button id="resetBtn" class="ghost-btn" type="button">Start a new day</button>';
  box.classList.remove("hidden");
  $("resetBtn").addEventListener("click", resetDay);
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// ---------- render ----------
const BTN = {
  idle: {
    label: "Start day",
    hint: "Start the day when you pick the hammer up. Pause whenever you stop hammering.",
  },
  active: {
    label: "Pause — start resting",
    hint: "Timing hammering. Pause the moment you put the hammer down.",
  },
  rest: {
    label: "Resume hammering",
    hint: "Timing rest. Resume when you pick the hammer back up.",
  },
  done: {
    label: "Day finished",
    hint: "Day closed. Start a new one from the summary.",
  },
};

const STATE_WORD = {
  idle: "Not started", active: "Hammering", rest: "Resting", done: "Finished",
};

function render() {
  const now = Date.now();
  const t = totals(now);
  const running = state.status === "active" || state.status === "rest";

  $("expState").textContent = STATE_WORD[state.status];
  $("expState").dataset.state = state.status;
  $("expClock").textContent = fmtClock(state.startedAt ? t.span : 0);

  const done = state.status === "done";
  $("shiftBtn").textContent = BTN[state.status].label;
  $("shiftBtn").classList.toggle("hidden", done);
  $("finishBtn").disabled = !running;
  $("finishBtn").classList.toggle("hidden", done);
  $("expHint").textContent = BTN[state.status].hint;
  // The shift summary repeats these totals, so don't show them twice.
  $("expStats").classList.toggle("hidden", done);

  $("statActive").textContent = fmtShort(t.active);
  $("statRest").textContent = fmtShort(t.rest);
  $("statBouts").textContent = String(t.bouts);
  $("statDuty").textContent = t.duty == null ? "—" : Math.round(t.duty * 100) + "%";

  // The hammer is locked in for the day once the clock is running.
  $("expWeight").disabled = state.status !== "idle";
  $("expBrand").disabled = state.status !== "idle";

  $("waveEmpty").classList.toggle("hidden", state.segments.length > 0);
  renderWave(now);
  renderSummary(now);
}

// ---------- wiring ----------
$("expWeight").addEventListener("input", () => {
  $("expWeightOut").innerHTML = $("expWeight").value + '<span class="unit">oz</span>';
});

$("shiftBtn").addEventListener("click", () => {
  if (state.status === "idle") startDay();
  else toggleWork();
});

$("finishBtn").addEventListener("click", finishDay);

restore();
if (state.status === "active" || state.status === "rest") startTicker();
$("expWeight").value = state.hammerOz;
$("expWeightOut").innerHTML = state.hammerOz + '<span class="unit">oz</span>';
$("expBrand").value = state.hammerBrand;
render();

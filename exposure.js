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
  status: "idle",          // idle | active | rest | unknown | done
  startedAt: null,
  finishedAt: null,
  hammerOz: 16,
  hammerBrand: "",
  segments: [],            // { state: "active" | "rest" | "unknown", start: ms, end: ms|null }
  hiddenAt: null,          // ms timestamp the tab last went hidden; null when not pending
  priorStatus: null,       // status to resume into once a pending "unknown" segment is resolved
});

// Tens-of-minutes range, per docs/exposure_stitching_research.md §4 (paper #4:
// fixed thresholds score well, F1 > 0.96, for gaps over ~60 min; precision
// below that doesn't matter much). Loosely tuned, not derived.
const GAP_THRESHOLD_MS = 30 * 60 * 1000;

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
      // The tab was hidden when it was last closed. If enough wall-clock
      // time has passed since, treat this reload the same as an in-session
      // tab-switch return: stitch the gap instead of silently stretching it
      // into whichever segment was open.
      if (state.hiddenAt != null && (state.status === "active" || state.status === "rest")) {
        const now = Date.now();
        if (now - state.hiddenAt >= GAP_THRESHOLD_MS) {
          stitchGap(state.hiddenAt, now);
        }
        state.hiddenAt = null;
      }
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
  let unknown = 0;
  let bouts = 0;
  let longest = 0;
  for (const seg of state.segments) {
    const ms = Math.max(0, segEnd(seg, now) - seg.start);
    if (seg.state === "active") {
      active += ms;
      bouts += 1;
      if (ms > longest) longest = ms;
    } else if (seg.state === "unknown") {
      unknown += ms;
    } else {
      rest += ms;
    }
  }
  // Elapsed time includes unresolved gaps; duty cycle does not — it's a
  // ratio of hammering to (hammering + rest) only.
  const worked = active + rest;
  const span = worked + unknown;
  return { active, rest, unknown, bouts, longest, span, duty: worked > 0 ? active / worked : null };
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

// Split the open segment at the moment the tab lost focus and insert the
// gap as its own "unknown" segment, instead of letting segEnd() silently
// stretch the open segment across time nobody watched.
// Per docs/exposure_stitching_research.md §4.
function stitchGap(hiddenAt, now) {
  if (state.status !== "active" && state.status !== "rest") return;
  const last = state.segments[state.segments.length - 1];
  if (!last || last.end != null) return;

  const splitAt = Math.max(last.start, hiddenAt);
  last.end = splitAt;
  state.segments.push({ state: "unknown", start: splitAt, end: now });
  state.priorStatus = state.status;
  state.status = "unknown";
  stopTicker();
}

// Resolve a pending "unknown" segment: fold it into active/rest, or drop it
// from the record entirely (the one case where elapsed time doesn't hold).
// "active"/"rest" describe what the gap itself was, so resume as that same
// state; "discard" throws the gap out and resumes whatever was running
// before the tab went hidden.
function resolveGap(choice) {
  if (state.status !== "unknown") return;
  const now = Date.now();
  const last = state.segments[state.segments.length - 1];
  let resume;

  if (choice === "discard") {
    if (last && last.state === "unknown") state.segments.pop();
    resume = state.priorStatus || "active";
  } else {
    if (last && last.state === "unknown") last.state = choice;
    resume = choice;
  }

  state.priorStatus = null;
  state.status = resume;
  openSegment(resume, now);
  startTicker();
  save();
  render();
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

const laneY = (kind) => {
  if (kind === "active") return CH.active;
  if (kind === "unknown") return (CH.active + CH.rest) / 2;
  return CH.rest;
};

const LANE_LABEL = { active: "Hammering", rest: "Rest", unknown: "Unknown" };
const LANE_COLOR = { active: "var(--exp-active)", rest: "var(--exp-rest)", unknown: "var(--exp-unknown)" };

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
      x1: gx, y1: CH.top, x2: gx, y2: CH.axis, stroke: "var(--grid)", "stroke-width": 1,
    }));
    svg.appendChild(el("text", {
      x: gx, y: CH.axis + 16, "text-anchor": "middle", class: "wave-axis",
    }, fmtAxis(t)));
  }
  svg.appendChild(el("line", {
    x1: CH.left, y1: CH.axis, x2: CH.right, y2: CH.axis,
    stroke: "var(--line)", "stroke-width": 1,
  }));
  svg.appendChild(el("text", {
    x: CH.right, y: CH.axis + 36, "text-anchor": "end", class: "wave-axis",
  }, "elapsed shift time"));

  // --- lane labels: identity is never colour alone ---
  ["active", "rest"].forEach((kind) => {
    svg.appendChild(el("text", {
      x: CH.left - 12, y: laneY(kind) + 4, "text-anchor": "end", class: "wave-lane",
    }, LANE_LABEL[kind]));
    svg.appendChild(el("line", {
      x1: CH.left, y1: laneY(kind), x2: CH.right, y2: laneY(kind),
      stroke: "var(--grid)", "stroke-width": 1,
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
        stroke: "var(--slate)", "stroke-width": 2, "stroke-linecap": "round",
      }));
    }
    const lineAttrs = {
      x1: x1, y1: y, x2: Math.max(x1 + 0.5, x2), y2: y,
      stroke: LANE_COLOR[seg.state], "stroke-width": 4, "stroke-linecap": "round",
    };
    if (seg.state === "unknown") lineAttrs["stroke-dasharray"] = "6 5";
    svg.appendChild(el("line", lineAttrs));
    prev = seg.state;
  });

  // --- live edge marker while the day is still running ---
  if (state.status === "active" || state.status === "rest") {
    svg.appendChild(el("circle", {
      cx: x(now), cy: laneY(state.status), r: 4.5,
      fill: "var(--panel)", stroke: "var(--ink)", "stroke-width": 2,
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

// ---------- alternative-pacing mini charts ----------
// Much smaller than CH (the main trace): no axis ticks, no hover tips, no
// live-edge marker -- these are schematic illustrations of a synthetic
// schedule, not a live recording, so the extra chrome renderWave() needs
// would be clutter. Reuses el() and LANE_COLOR so colour stays identical to
// the main chart. Per docs/exposure_pacing_research.md (private repo).
const CH_MINI = { left: 8, right: 304, active: 20, rest: 56, axis: 72 };

function drawMiniWave(svg, segments, span) {
  svg.textContent = "";
  if (!segments.length || span <= 0) return;
  const x = (t) => CH_MINI.left + (t / span) * (CH_MINI.right - CH_MINI.left);
  const laneYMini = (kind) => (kind === "active" ? CH_MINI.active : CH_MINI.rest);
  svg.appendChild(el("line", {
    x1: CH_MINI.left, y1: CH_MINI.axis, x2: CH_MINI.right, y2: CH_MINI.axis,
    stroke: "var(--line)", "stroke-width": 1,
  }));
  segments.forEach((seg) => {
    const x1 = x(seg.start);
    const x2 = x(seg.end);
    svg.appendChild(el("line", {
      x1, y1: laneYMini(seg.state), x2: Math.max(x1 + 0.5, x2), y2: laneYMini(seg.state),
      stroke: LANE_COLOR[seg.state], "stroke-width": 6, "stroke-linecap": "round",
    }));
  });
}

function waveAlt(now) {
  const t = totals(now);
  return "Square wave of the shift: " + t.bouts + " active stretch"
    + (t.bouts === 1 ? "" : "es") + ", " + fmtShort(t.active)
    + " hammering against " + fmtShort(t.rest) + " rest.";
}

function showTip(evt, seg, now) {
  const tip = $("waveTip");
  const dur = Math.max(0, segEnd(seg, now) - seg.start);
  const from = Math.max(0, seg.start - state.startedAt);
  tip.innerHTML = "<b>" + LANE_LABEL[seg.state] + "</b>"
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
    + '<div><dt>Longest active stretch</dt><dd>' + fmtShort(t.longest) + '</dd></div>'
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

// Three ways today's own active/rest totals could have been paced instead.
// Illustrative only -- not ranked, not a recommendation. See
// docs/exposure_pacing_research.md §4 (private repo) for why: the pacing
// literature disagrees on which pattern reduces fatigue more, and none of
// it is about hammering.
const PACING_PATTERNS = [
  { kind: "short", id: "expPaceShort", fn: "fn-pace-short",
    title: "Short & frequent", blurb: "Many short active stretches, many short rests." },
  { kind: "long", id: "expPaceLong", fn: "fn-pace-long",
    title: "Long & infrequent", blurb: "A few long active stretches, a few long rests." },
  { kind: "even", id: "expPaceEven", fn: "fn-pace-even",
    title: "Evenly spaced", blurb: "Active stretches and rests of roughly equal length, spread evenly." },
];

function renderPacingIdeas(now) {
  const box = $("expPacingIdeas");
  if (state.status !== "done") {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const t = totals(now);
  // Fold any residual "unknown" time into rest so active + rest == span
  // exactly. Not reachable in normal use -- finishDay() only runs from
  // "active"/"rest" status -- but keeps the identity exact if it ever is.
  const folded = { active: t.active, rest: t.rest + t.unknown, bouts: t.bouts };
  if (folded.active <= 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  box.innerHTML = buildPacingMarkup();
  box.classList.remove("hidden");

  const span = folded.active + folded.rest;
  PACING_PATTERNS.forEach(({ kind, id }) => {
    const segs = buildAlternateSchedule(folded, kind);
    drawMiniWave($(id), segs, span);
  });
}

function buildPacingMarkup() {
  const cards = PACING_PATTERNS.map(({ id, fn, title, blurb }) => ''
    + '<figure class="pacing-card">'
    + '<figcaption>' + title
    + '<a id="ref-' + fn + '" class="fn-ref" href="#' + fn + '" aria-label="Note: ' + title + '">*</a></figcaption>'
    + '<p class="pacing-blurb">' + blurb + '</p>'
    + '<svg id="' + id + '" class="wave-mini" viewBox="0 0 312 86" role="img" '
    + 'aria-label="' + title + ' alternative pacing of the same recorded totals"></svg>'
    + '</figure>'
  ).join('');

  return ''
    + '<p class="chart-title">Three ways the same totals could have been paced</p>'
    + '<p class="pacing-note">Not a record of what happened, and none of these is shown '
    + 'as better than another. Each re-splits today’s own hammering and rest totals '
    + 'into a different active/rest cadence. Pacing research is mixed and task-dependent, '
    + 'and no study was found on hammering specifically — see the notes below.</p>'
    + '<div class="pacing-grid">' + cards + '</div>'
    + '<aside class="footnotes pacing-footnotes" aria-labelledby="fnPaceHead">'
    + '<p id="fnPaceHead" class="fn-head">Notes on these patterns</p>'
    + '<ol class="fn-list">'
    + '<li id="fn-pace-short"><a class="fn-ref" href="#ref-fn-pace-short" aria-label="Back">*</a> '
    + 'Short, frequent micro-breaks reduced measured muscle fatigue in a material-handling '
    + 'task (Beltran Martinez et al., 2023) — a different task than hammering.</li>'
    + '<li id="fn-pace-long"><a class="fn-ref" href="#ref-fn-pace-long" aria-label="Back">*</a> '
    + 'Long, self-selected breaks produced less fatigue than short-frequent ones in a '
    + 'precision-work task (Ergonomics, 2021) — the opposite finding from the short pattern’s '
    + 'citation, on a different task.</li>'
    + '<li id="fn-pace-even"><a class="fn-ref" href="#ref-fn-pace-even" aria-label="Back">*</a> '
    + 'No single study backs one fixed work-rest ratio; shown as a neutral baseline, not a '
    + 'third vote. See docs/exposure_pacing_research.md for the full picture.</li>'
    + '</ol>'
    + '</aside>';
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
  unknown: {
    label: "Resolve the gap below",
    hint: "The tracker couldn't see this tab for a while — label it below before continuing.",
  },
  done: {
    label: "Day finished",
    hint: "Day closed. Start a new one from the summary.",
  },
};

const STATE_WORD = {
  idle: "Not started", active: "Hammering", rest: "Resting", unknown: "Gap — unresolved", done: "Finished",
};

function render() {
  const now = Date.now();
  const t = totals(now);
  const running = state.status === "active" || state.status === "rest";
  const pendingGap = state.status === "unknown";

  $("expState").textContent = STATE_WORD[state.status];
  $("expState").dataset.state = state.status;
  $("expClock").textContent = fmtClock(state.startedAt ? t.span : 0);

  const done = state.status === "done";
  $("shiftBtn").textContent = BTN[state.status].label;
  $("shiftBtn").classList.toggle("hidden", done);
  $("shiftBtn").disabled = pendingGap;
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

  renderGapPrompt(pendingGap, now);

  $("waveEmpty").classList.toggle("hidden", state.segments.length > 0);
  renderWave(now);
  renderSummary(now);
  renderPacingIdeas(now);
}

function renderGapPrompt(pending, now) {
  const box = $("expGapPrompt");
  box.classList.toggle("hidden", !pending);
  if (!pending) return;
  const last = state.segments[state.segments.length - 1];
  const dur = last ? Math.max(0, segEnd(last, now) - last.start) : 0;
  $("expGapDuration").textContent = fmtShort(dur);
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

$("expGapActive").addEventListener("click", () => resolveGap("active"));
$("expGapRest").addEventListener("click", () => resolveGap("rest"));
$("expGapDiscard").addEventListener("click", () => resolveGap("discard"));

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.status === "active" || state.status === "rest") {
      state.hiddenAt = Date.now();
      save();
    }
    return;
  }
  // Tab is visible again.
  if (state.hiddenAt != null) {
    const now = Date.now();
    if (now - state.hiddenAt >= GAP_THRESHOLD_MS) {
      stitchGap(state.hiddenAt, now);
    }
    state.hiddenAt = null;
    save();
    render();
  }
});

restore();
if (state.status === "active" || state.status === "rest") startTicker();
$("expWeight").value = state.hammerOz;
$("expWeightOut").innerHTML = state.hammerOz + '<span class="unit">oz</span>';
$("expBrand").value = state.hammerBrand;
render();

/* Alternative-pacing schedule generator for the Exposure Tracker's shift
   summary. Pure, side-effect-free: given the SAME recorded active/rest
   totals from one finished shift, produces a synthetic segments[] array
   (same shape as state.segments in exposure.js -- {state, start, end} --
   but start/end are ms offsets from 0, not epoch ms) that re-paces those
   totals into a different bout/rest cadence.

   No pattern here is shown as "better." The research behind why these three
   patterns, and why they are deliberately unranked, is
   docs/exposure_pacing_research.md (private repo) -- see its §4 before
   changing any copy that uses this module's output. */

// 3 min, loosely tuned toward the short-break cadence in the fatigue study
// that grounds this pattern -- not derived from it precisely. Per
// docs/exposure_pacing_research.md §5.1 (citation #1).
const TARGET_BOUT_MS = 3 * 60 * 1000;
const MAX_SHORT_BOUTS = 40; // sanity cap: an 8h shift shouldn't render 150+ bars

// 10 min floor so a "long" bout actually reads as long rather than merely
// "fewer of the same short bouts." Per docs/exposure_pacing_research.md §5.2
// (citations #2, #4) -- loosely tuned, not derived, same register as
// GAP_THRESHOLD_MS in exposure.js.
const MIN_LONG_BOUT_MS = 10 * 60 * 1000;
const MAX_LONG_BOUTS = 3;

// 3-6 bouts for "evenly spaced," anchored to the shift's own recorded bout
// count when there were enough of them to be illustrative. Per
// docs/exposure_pacing_research.md §5.3 (citations #3, #5 -- no fixed ratio
// is backed by evidence, so this is a neutral baseline, not a third vote).
const EVEN_BOUTS_MIN = 3;
const EVEN_BOUTS_MAX = 6;
const EVEN_BOUTS_DEFAULT = 4;

function shortBoutCount(activeMs) {
  if (activeMs <= 0) return 0;
  return Math.min(MAX_SHORT_BOUTS, Math.max(1, Math.round(activeMs / TARGET_BOUT_MS)));
}

function longBoutCount(activeMs) {
  if (activeMs <= 0) return 0;
  for (let n = MAX_LONG_BOUTS; n >= 2; n--) {
    if (activeMs / n >= MIN_LONG_BOUT_MS) return n;
  }
  return 1;
}

function evenBoutCount(recordedBouts) {
  if (!recordedBouts || recordedBouts < EVEN_BOUTS_MIN) return EVEN_BOUTS_DEFAULT;
  return Math.min(recordedBouts, EVEN_BOUTS_MAX);
}

// totals: { active, rest, bouts } in ms/count. Caller is responsible for
// folding any "unknown" segment time into rest first (see exposure.js
// renderPacingIdeas) so active + rest == span exactly here.
// kind: "short" | "long" | "even".
function buildAlternateSchedule(totals, kind) {
  const { active, rest, bouts } = totals;
  if (active <= 0) return []; // nothing recorded to re-pace

  let n;
  if (kind === "short") n = shortBoutCount(active);
  else if (kind === "long") n = longBoutCount(active);
  else n = evenBoutCount(bouts);

  // No rest was recorded at all: there's no break cadence to redistribute --
  // all three patterns collapse to the same single block. Return that block
  // once rather than three visually-identical fakes of a "pattern."
  if (rest <= 0 || n <= 0) {
    return [{ state: "active", start: 0, end: active }];
  }

  const boutMs = active / n;
  const restMs = rest / n;
  const segments = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    segments.push({ state: "active", start: cursor, end: cursor + boutMs });
    cursor += boutMs;
    segments.push({ state: "rest", start: cursor, end: cursor + restMs });
    cursor += restMs;
  }
  return segments;
}

// Dual export: CommonJS for Node tests, global script scope for the browser
// (exposure.html loads this as a classic <script> before exposure.js, so
// these names are already in scope there -- no window.* namespace needed).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildAlternateSchedule, shortBoutCount, longBoutCount, evenBoutCount };
}

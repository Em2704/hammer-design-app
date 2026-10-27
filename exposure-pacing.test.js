/* Unit tests for the alternative-pacing schedule generator.
 * Run: node exposure-pacing.test.js
 * No framework — plain assertions so it runs anywhere Node is installed. */

const assert = require("assert");
const {
  buildAlternateSchedule, shortBoutCount, longBoutCount, evenBoutCount,
} = require("./exposure-pacing");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

const MIN = 60 * 1000;

function sumByState(segments, state) {
  return segments
    .filter((s) => s.state === state)
    .reduce((acc, s) => acc + (s.end - s.start), 0);
}

console.log("exposure-pacing — alternative schedule generator\n");

// --- totals preserved exactly, for all three kinds ---
["short", "long", "even"].forEach((kind) => {
  test(`${kind}: preserves total active + rest exactly`, () => {
    const totals = { active: 90 * MIN, rest: 30 * MIN, bouts: 6 };
    const segs = buildAlternateSchedule(totals, kind);
    assert.strictEqual(sumByState(segs, "active"), totals.active);
    assert.strictEqual(sumByState(segs, "rest"), totals.rest);
  });
});

// --- edge cases ---
test("active <= 0 returns an empty schedule for every kind", () => {
  ["short", "long", "even"].forEach((kind) => {
    assert.deepStrictEqual(buildAlternateSchedule({ active: 0, rest: 30 * MIN, bouts: 2 }, kind), []);
  });
});

test("rest <= 0 collapses to a single active block for every kind", () => {
  ["short", "long", "even"].forEach((kind) => {
    const segs = buildAlternateSchedule({ active: 40 * MIN, rest: 0, bouts: 3 }, kind);
    assert.strictEqual(segs.length, 1);
    assert.strictEqual(segs[0].state, "active");
    assert.strictEqual(segs[0].start, 0);
    assert.strictEqual(segs[0].end, 40 * MIN);
  });
});

test("segments are contiguous and strictly alternating active/rest", () => {
  const segs = buildAlternateSchedule({ active: 90 * MIN, rest: 30 * MIN, bouts: 6 }, "short");
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) assert.strictEqual(segs[i].start, segs[i - 1].end);
    if (i > 0) assert.notStrictEqual(segs[i].state, segs[i - 1].state);
  }
});

// --- bout-count boundary values ---
test("shortBoutCount: tiny active time still yields at least 1 bout", () => {
  assert.strictEqual(shortBoutCount(10 * 1000), 1);
});

test("shortBoutCount: caps at MAX_SHORT_BOUTS on a very long shift", () => {
  assert.strictEqual(shortBoutCount(40 * 60 * MIN), 40);
});

test("shortBoutCount: zero or negative active time yields 0 bouts", () => {
  assert.strictEqual(shortBoutCount(0), 0);
  assert.strictEqual(shortBoutCount(-5), 0);
});

test("longBoutCount: short active time falls back to 1 bout", () => {
  assert.strictEqual(longBoutCount(5 * MIN), 1);
});

test("longBoutCount: long active time uses up to MAX_LONG_BOUTS", () => {
  assert.strictEqual(longBoutCount(30 * MIN), 3);
});

test("evenBoutCount: falls back to the default when too few bouts were recorded", () => {
  assert.strictEqual(evenBoutCount(0), 4);
  assert.strictEqual(evenBoutCount(1), 4);
});

test("evenBoutCount: anchors to the recorded bout count within range", () => {
  assert.strictEqual(evenBoutCount(5), 5);
});

test("evenBoutCount: clamps a very fragmented recorded count to the max", () => {
  assert.strictEqual(evenBoutCount(40), 6);
});

console.log(`\n${passed} passed`);

/**
 * refresh-verification-fixture-dates.js
 * ---------------------------------------------------------------------------
 * Keeps examples/verification-schedule.json's dates positioned sensibly
 * relative to today, so the Gantt's Today marker always lands with useful
 * context on both sides (some completed work behind it, several weeks of
 * upcoming work ahead) instead of drifting toward — or past — the end of the
 * fixture's date range as real time passes.
 *
 * Design: shift every date-shaped value in the CURRENT file by a fixed
 * number of days, rather than regenerating the fixture from scratch. This is
 * deliberate — the fixture accumulates real edits over time (new tasks added
 * to exercise a new feature, tweaked descriptions, etc.), and a from-scratch
 * regeneration would throw all of that away. A uniform day-shift preserves
 * every relationship in the file (durations, dependency lag, which task is
 * overdue vs. upcoming) exactly as authored; only the absolute dates move.
 *
 * Also deliberate: this rewrites only the date-shaped string values via
 * targeted regex replacement, not a JSON.parse()+stringify() round-trip.
 * The latter reformats every array/object in the file (e.g. flattening
 * "resources": ["Alice"] onto multiple lines) regardless of whether it
 * changed, turning what should be a small, reviewable diff of just date
 * values into a much noisier one full of incidental whitespace churn.
 *
 * Idempotent by design: does nothing (no file write, exit 0) if today is
 * already reasonably positioned. Run via the pre-commit hook (.githooks/
 * pre-commit) on every commit, or directly:
 *
 *   node tests/refresh-verification-fixture-dates.js
 *   node tests/refresh-verification-fixture-dates.js --check   (exit 1 if a
 *     shift would be applied, without writing — for CI/manual inspection)
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_PATH = path.join(__dirname, '..', 'examples', 'verification-schedule.json');

// Where today should sit, as a fraction of the way through the fixture's
// whole start-to-end range. Only reshuffle if it's drifted meaningfully away
// from that — keeps this a no-op on most commits instead of nudging the file
// by a day or two every single time.
const TARGET_FRACTION = 1 / 3;
const TOLERANCE_FRACTION = 0.12; // don't touch it while within ~12 percentage points of target

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

function shiftISO(iso, shiftDays) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + shiftDays);
  return d.toISOString().slice(0, 10);
}

function computeShift(data) {
  let minD = null, maxD = null;
  for (const t of data.tasks) {
    if (t.start && (!minD || t.start < minD)) minD = t.start;
    if (t.end && (!maxD || t.end > maxD)) maxD = t.end;
  }
  if (!minD || !maxD) return null; // nothing to anchor against

  const today = todayISO();
  const totalDays = daysBetween(minD, maxD);
  if (totalDays <= 0) return null;
  const todayFraction = daysBetween(minD, today) / totalDays;

  if (Math.abs(todayFraction - TARGET_FRACTION) <= TOLERANCE_FRACTION) {
    return { shiftDays: 0, todayFraction, minD, maxD };
  }

  // Solve for the shift that puts today at exactly TARGET_FRACTION through
  // the (unchanged-length) range: today - shiftDays should sit
  // TARGET_FRACTION*totalDays after the shifted minD (== minD + shiftDays).
  //   today = (minD + shiftDays) + TARGET_FRACTION * totalDays
  //   shiftDays = today - minD - TARGET_FRACTION * totalDays
  const shiftDays = daysBetween(minD, today) - Math.round(TARGET_FRACTION * totalDays);
  return { shiftDays, todayFraction, minD, maxD };
}

function applyShift(text, shiftDays) {
  // Every task's start/end (skips 'end': null — doesn't match the date pattern).
  text = text.replace(/("(?:start|end)": ")(\d{4}-\d{2}-\d{2})(")/g,
    (m, pre, iso, post) => pre + shiftISO(iso, shiftDays) + post);

  // Every date inside the holidays array specifically, isolated first so we
  // don't touch a date-shaped string anywhere else in the file.
  text = text.replace(/("holidays": \[)([\s\S]*?)(\n\s*\])/, (m, pre, body, post) => {
    const newBody = body.replace(/"(\d{4}-\d{2}-\d{2})"/g,
      (mm, iso) => '"' + shiftISO(iso, shiftDays) + '"');
    return pre + newBody + post;
  });

  const nowIso = new Date().toISOString();
  text = text.replace(/"created": "[^"]+"/, '"created": "' + nowIso + '"');
  text = text.replace(/"modified": "[^"]+"/, '"modified": "' + nowIso + '"');

  return text;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const text = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const data = JSON.parse(text);

  const result = computeShift(data);
  if (!result) {
    console.log('refresh-verification-fixture-dates: nothing to anchor against, skipping.');
    return;
  }
  if (result.shiftDays === 0) {
    console.log(`refresh-verification-fixture-dates: today is at ${(result.todayFraction * 100).toFixed(1)}% ` +
      `through the range (target ~${(TARGET_FRACTION * 100).toFixed(0)}%) — close enough, no change.`);
    return;
  }

  console.log(`refresh-verification-fixture-dates: today is at ${(result.todayFraction * 100).toFixed(1)}% ` +
    `through the range — shifting every date by ${result.shiftDays} day(s) to bring it back to ` +
    `~${(TARGET_FRACTION * 100).toFixed(0)}%.`);

  if (checkOnly) {
    console.log('(--check mode: not writing. Run without --check to apply.)');
    process.exit(1);
  }

  const newText = applyShift(text, result.shiftDays);
  JSON.parse(newText); // fail loudly here, not with a corrupted file on disk, if the regex went wrong
  fs.writeFileSync(FIXTURE_PATH, newText);
  console.log('refresh-verification-fixture-dates: examples/verification-schedule.json updated.');
}

main();

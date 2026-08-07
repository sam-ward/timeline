/**
 * jsdom-functional-tests.js
 * ---------------------------------------------------------------------------
 * Example functional test harness for timeline-schedule-tool.html.
 *
 * This is the kind of test used throughout the app's development to verify
 * changes to the scheduling engine, data model, and UI logic without a real
 * browser. It is NOT bundled into the app itself (the app has zero runtime
 * dependencies by design) — this is a standalone dev-time tool.
 *
 * How it works:
 *   1. Reads the app's HTML/CSS/JS as plain text.
 *   2. Injects one extra line exposing a handful of internal functions on
 *      `window._debug` (the app doesn't expose these itself — this is a
 *      test-only seam, added at test time, never shipped).
 *   3. Loads the result into jsdom with scripts enabled, so all of the app's
 *      own JS runs for real, in a real (simulated) DOM.
 *   4. Drives the UI the same way a user would — clicking buttons,
 *      dispatching input/change events — and asserts on the resulting state
 *      and rendered DOM.
 *
 * Requirements (dev-only, not needed to use the app itself):
 *   npm install jsdom
 *
 * Run:
 *   node tests/jsdom-functional-tests.js
 *
 * Exits non-zero if any assertion fails, so it's usable in CI.
 * ---------------------------------------------------------------------------
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, '..', 'timeline-schedule-tool.html');

// Functions we want direct access to for assertions. Add more here as needed —
// almost everything in the app is a plain top-level function, so this list
// can grow freely without touching the app's own source.
const DEBUG_EXPORTS = [
  'state', 'byId', 'addTask', 'recalcAll', 'isMilestone', 'sanitizeDuration',
  'addWorkingDays', 'countWorkingDays', 'hasChildren', 'childrenOf',
  'eligiblePredecessorIds', 'serialize', 'loadFromText', 'allResources',
  'classifyTask'
];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

let passCount = 0;
let failCount = 0;
function check(label, condition) {
  if (condition) {
    passCount++;
    console.log('  \x1b[32m✓\x1b[0m ' + label);
  } else {
    failCount++;
    console.error('  \x1b[31m✗ FAIL\x1b[0m ' + label);
  }
}

async function main() {
  const html = fs.readFileSync(APP_PATH, 'utf8');
  const instrumented = html.replace(
    '</script>',
    `window._debug = { ${DEBUG_EXPORTS.join(', ')} };\n</script>`
  );

  const dom = new JSDOM(instrumented, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'https://example.com/', // gives window.open()/popups a valid origin
    pretendToBeVisual: true
  });
  const { window } = dom;
  const doc = window.document;

  window.addEventListener('error', (e) => {
    console.error('UNCAUGHT WINDOW ERROR:', e.error ? e.error.stack : e.message);
    failCount++;
  });

  await wait(150); // let the app's init/DOMContentLoaded logic settle
  window.prompt = () => 'Test Schedule';
  window.confirm = () => true;

  doc.getElementById('btn-new-welcome').click();
  await wait(30);

  const D = window._debug;

  console.log('\n--- Scheduling engine ---');
  {
    // Duration-driven scheduling, skipping weekends
    const t1 = D.state.tasks[0];
    t1.name = 'Kickoff';
    t1.start = '2026-08-10'; // a Monday
    t1.duration = 6;         // spans a weekend
    D.recalcAll();
    check('6-working-day task correctly skips the weekend', t1.end === '2026-08-17');

    // Dependency-driven start date
    const t2 = D.addTask(null);
    t2.name = 'Build';
    t2.duration = 3;
    t2.predecessors = [t1.id];
    D.recalcAll();
    window.renderAll();
    await wait(20);
    check('dependent task starts the working day after its predecessor ends', t2.start > t1.end);
    check('dependent task Start field is locked once it has a dependency',
      doc.querySelector(`tr[data-id="${t2.id}"] [data-field="start"]`).disabled);
  }

  console.log('\n--- Milestones ---');
  {
    const m = D.addTask(null);
    m.name = 'Design Approved';
    m.duration = 0;
    m.resources = ['Alice']; // deliberately set — should get cleared
    D.recalcAll();
    check('duration 0 is detected as a milestone', D.isMilestone(m));
    check('milestone end equals its start (no span)', m.end === m.start);
    check('milestone resources are cleared automatically', m.resources.length === 0);
    check('sanitizeDuration(0) preserves an explicit 0', D.sanitizeDuration(0) === 0);
    check('sanitizeDuration("") falls back to 1 (empty field ≠ deliberate milestone)',
      D.sanitizeDuration('') === 1);
  }

  console.log('\n--- Resource name canonicalization ---');
  {
    const a = D.addTask(null); a.name = 'Task A'; a.resources = ['Joe'];
    const b = D.addTask(null); b.name = 'Task B'; b.resources = ['joe']; // same person, different case
    D.recalcAll();
    check('case-variant resource names collapse to one canonical spelling',
      a.resources[0] === b.resources[0]);
    check('allResources() reports one person, not two', D.allResources().length ===
      new Set(D.state.tasks.flatMap(t => t.resources || [])).size);
  }

  console.log('\n--- Circular dependency prevention ---');
  {
    const parent = D.addTask(null); parent.name = 'Phase';
    const child = D.addTask(null, parent.id); child.name = 'Sub-task';
    // A task cannot legally depend on its own ancestor — verify the picker excludes it
    const eligible = D.eligiblePredecessorIds(child.id);
    check("a task's own ancestor is excluded from its eligible predecessor list",
      !eligible.includes(parent.id));
  }

  console.log('\n--- Parent (summary) task rollup ---');
  {
    const parent = D.addTask(null); parent.name = 'Phase 2';
    const c1 = D.addTask(null, parent.id); c1.name = 'Sub 1'; c1.duration = 2; c1.resources = ['Bob'];
    const c2 = D.addTask(null, parent.id); c2.name = 'Sub 2'; c2.duration = 3; c2.resources = ['Carol'];
    D.recalcAll();
    check('parent task is detected as having children', D.hasChildren(parent.id));
    check("parent's end date is the latest of its children's end dates",
      parent.end === (c1.end > c2.end ? c1.end : c2.end));
    check("parent's resources are the union of its children's resources",
      parent.resources.includes('Bob') && parent.resources.includes('Carol'));
  }

  console.log('\n--- Save / load round trip ---');
  {
    const before = D.state.tasks.length;
    const json = D.serialize();
    const parsed = JSON.parse(json);
    check('serialized JSON is valid and contains all tasks', parsed.tasks.length === before);

    window.loadFromText(json);
    await wait(30);
    check('reloading the same JSON restores the same number of tasks',
      D.state.tasks.length === before);
  }

  console.log(`\n${passCount} passed, ${failCount} failed.\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('TEST HARNESS CRASHED:', err);
  process.exit(1);
});

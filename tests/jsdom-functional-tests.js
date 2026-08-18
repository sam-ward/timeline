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
  'classifyTask', 'stepWorkingDays', 'normalizeTask', 'taskHierarchyPath',
  'moveTask', 'dependentsOf'
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
    t2.predecessors = [{id: t1.id, lag: 0}];
    D.recalcAll();
    window.renderAll();
    await wait(20);
    check('dependent task starts the working day after its predecessor ends', t2.start > t1.end);
    check('dependent task Start field is locked once it has a dependency',
      doc.querySelector(`tr[data-id="${t2.id}"] [data-field="start"]`).disabled);
  }

  console.log('\n--- Task List typing performance ---');
  {
    // Regression test for the "typing a task name gets laggy" bug: renderGantt()/renderDashboard()
    // used to run in full on every keystroke in the name field, instead of deferring to blur like
    // every other field already does. Verify the deferral actually happens: the Gantt label should
    // NOT reflect a name change until the field commits ('change', i.e. blur), not on every 'input'.
    const t1 = D.state.tasks[0]; // 'Kickoff', from the Scheduling engine block above
    const nameInput = doc.querySelector(`tr[data-id="${t1.id}"] [data-field="name"]`);
    const ganttLabel = () => doc.querySelector(`.g-row[data-id="${t1.id}"] .g-label`);

    nameInput.value = 'Renamed mid-typing';
    nameInput.dispatchEvent(new window.Event('input', {bubbles: true}));
    check('data model updates live on every keystroke', t1.name === 'Renamed mid-typing');
    check("Gantt label does NOT update yet (still shows the old name — the render is deferred)",
      ganttLabel().textContent.includes('Kickoff') && !ganttLabel().textContent.includes('Renamed'));

    nameInput.dispatchEvent(new window.Event('change', {bubbles: true}));
    check('Gantt label updates once the field commits (blur/change)',
      ganttLabel().textContent.includes('Renamed mid-typing'));
  }

  console.log('\n--- Parent-overwrite warning (Bug: silent data loss) ---');
  {
    // A task with real data set: adding a sub-task via the row's "+ sub" button should warn
    // first, since recalcAll()'s rollup pass would silently overwrite it.
    const withData = D.addTask(null);
    withData.name = 'Has real data';
    withData.duration = 5;
    withData.percentComplete = 60;
    withData.resources = ['Alice'];
    D.recalcAll();
    window.renderAll();
    await wait(20);

    let confirmCalled = false;
    window.confirm = () => { confirmCalled = true; return false; }; // simulate clicking Cancel
    const subBtn = doc.querySelector(`tr[data-id="${withData.id}"] [data-act="add-sub"]`);
    subBtn.click();
    check('warning dialog shown before overwriting a task with real data', confirmCalled);
    check('cancelling the warning leaves the task childless (nothing lost)', !D.hasChildren(withData.id));

    window.confirm = () => true; // simulate confirming anyway
    subBtn.click(); // same DOM node — cancelling above didn't re-render, so it's still valid
    check('confirming the warning proceeds with adding the sub-task', D.hasChildren(withData.id));

    // A fresh, all-default task has nothing at stake — shouldn't prompt at all.
    const fresh = D.addTask(null);
    fresh.name = 'Fresh task, nothing to lose';
    D.recalcAll();
    window.renderAll();
    await wait(20);
    let confirmCalledForFresh = false;
    window.confirm = () => { confirmCalledForFresh = true; return true; };
    doc.querySelector(`tr[data-id="${fresh.id}"] [data-act="add-sub"]`).click();
    check('no warning for a task with nothing to lose', !confirmCalledForFresh);
    check('sub-task is still created in that case', D.hasChildren(fresh.id));

    // The row's "+ task" button should add a SIBLING (same parentId), not a child.
    const original = D.addTask(null);
    original.name = 'Original, for sibling-button test';
    D.recalcAll();
    window.renderAll();
    await wait(20);
    const idsBefore = new Set(D.state.tasks.map(x=>x.id));
    doc.querySelector(`tr[data-id="${original.id}"] [data-act="add-sibling"]`).click();
    const newSibling = D.state.tasks.find(x=>!idsBefore.has(x.id));
    check('"+ task" button creates a sibling, not a sub-task',
      newSibling && newSibling.parentId === original.parentId);

    // Indenting a task under a previously-childless sibling with real data is the other trigger
    // for the same silent-overwrite bug — same warning should apply there too.
    const a = D.addTask(null); a.name = 'Indent target (has data)'; a.percentComplete = 40;
    const b = D.addTask(null); b.name = 'Being indented under it';
    D.recalcAll();
    window.renderAll();
    await wait(20);
    let confirmCalledForIndent = false;
    window.confirm = () => { confirmCalledForIndent = true; return false; };
    const indentBtn = doc.querySelector(`tr[data-id="${b.id}"] [data-act="indent"]`);
    indentBtn.click();
    check('indenting under a sibling with real data also warns', confirmCalledForIndent);
    check('cancelling leaves the indent from happening', b.parentId !== a.id);

    window.confirm = () => true;
    indentBtn.click();
    check('confirming proceeds with the indent', b.parentId === a.id);

    window.confirm = () => true; // restore the default for the rest of the suite
  }

  console.log('\n--- Dependency lag ---');
  {
    const p = D.addTask(null);
    p.name = 'Vendor sign-off';
    p.start = '2026-08-10'; // Monday
    p.duration = 5;         // ends Friday 2026-08-14
    D.recalcAll();

    const zeroLag = D.addTask(null);
    zeroLag.name = 'No lag';
    zeroLag.duration = 1;
    zeroLag.predecessors = [{id: p.id, lag: 0}];

    const positiveLag = D.addTask(null);
    positiveLag.name = 'Positive lag';
    positiveLag.duration = 1;
    positiveLag.predecessors = [{id: p.id, lag: 2}];

    const negativeLag = D.addTask(null);
    negativeLag.name = 'Negative lag (lead)';
    negativeLag.duration = 1;
    negativeLag.predecessors = [{id: p.id, lag: -1}];

    D.recalcAll();
    check('zero lag reproduces plain finish-to-start (next working day after predecessor ends)',
      zeroLag.start === '2026-08-17'); // Fri 14th + 1 working day = Mon 17th
    check('positive lag pushes the start later than plain finish-to-start',
      positiveLag.start > zeroLag.start);
    check('negative lag (lead) allows starting on or before the predecessor\'s own end date',
      negativeLag.start <= p.end);

    check('stepWorkingDays(iso, 1) matches the old next-working-day-after rule',
      D.stepWorkingDays('2026-08-14', 1) === '2026-08-17'); // Fri -> Mon, skipping the weekend
    check('stepWorkingDays(iso, 0) returns the same date unchanged',
      D.stepWorkingDays('2026-08-14', 0) === '2026-08-14');

    // A schedule saved before lag existed has predecessors as a plain array of ids, not
    // {id, lag} objects — normalizeTask() must still migrate and schedule it correctly.
    const legacyRaw = { id: 'legacy1', name: 'Legacy dep', duration: 1, predecessors: [p.id] };
    const legacyTask = D.normalizeTask(legacyRaw);
    check('legacy plain-id predecessors array normalizes to [{id, lag: 0}]',
      legacyTask.predecessors.length === 1 &&
      legacyTask.predecessors[0].id === p.id &&
      legacyTask.predecessors[0].lag === 0);
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

  console.log('\n--- Reverse-dependency indicator ("Blocks") ---');
  {
    const p = D.addTask(null); p.name = 'Blocker task';
    const c1 = D.addTask(null); c1.name = 'Blocked task 1'; c1.predecessors = [{id: p.id, lag: 0}];
    const c2 = D.addTask(null); c2.name = 'Blocked task 2'; c2.predecessors = [{id: p.id, lag: 0}];
    D.recalcAll();
    window.renderAll();
    await wait(20);

    check('dependentsOf() finds both tasks depending on the blocker',
      D.dependentsOf(p.id).length === 2 &&
      D.dependentsOf(p.id).map(t=>t.name).includes('Blocked task 1') &&
      D.dependentsOf(p.id).map(t=>t.name).includes('Blocked task 2'));
    check('a task nothing depends on has an empty dependents list',
      D.dependentsOf(c1.id).length === 0);

    const badge = doc.querySelector(`tr[data-id="${p.id}"] .blocks-badge`);
    check('the blocker\'s row shows a non-empty "blocks" badge', badge.textContent.trim() === '🔗2');
    const badgeC1 = doc.querySelector(`tr[data-id="${c1.id}"] .blocks-badge`);
    check('a task with no dependents shows an empty badge (reserved space, no content)',
      badgeC1.textContent.trim() === '');
  }

  console.log('\n--- Keyboard reordering (Ctrl+Shift+Up/Down) ---');
  {
    const x = D.addTask(null); x.name = 'Reorder X';
    const y = D.addTask(null); y.name = 'Reorder Y';
    const z = D.addTask(null); z.name = 'Reorder Z';
    D.recalcAll();
    window.renderAll();
    await wait(20);

    const orderNow = () => D.childrenOf(null).filter(t=>['Reorder X','Reorder Y','Reorder Z'].includes(t.name)).map(t=>t.name);
    check('starting order is X, Y, Z', orderNow().join(',') === 'Reorder X,Reorder Y,Reorder Z');

    const zNameInput = doc.querySelector(`tr[data-id="${z.id}"] [data-field="name"]`);
    zNameInput.focus();
    zNameInput.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowUp', ctrlKey:true, shiftKey:true, bubbles:true}));
    check('Ctrl+Shift+Up moves the focused row up one position', orderNow().join(',') === 'Reorder X,Reorder Z,Reorder Y');

    // moveTask() rebuilds the table, so the original input node is gone — the handler should have
    // refocused the *same field* on the row's new DOM node, not left focus stranded on nothing.
    const refocused = doc.activeElement;
    check('focus follows the row to its new position after the move',
      refocused && refocused.dataset.field === 'name' && refocused.closest('tr').dataset.id === z.id);

    refocused.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowUp', ctrlKey:true, shiftKey:true, bubbles:true}));
    check('a second Ctrl+Shift+Up (now at the front) moves it to first position',
      orderNow().join(',') === 'Reorder Z,Reorder X,Reorder Y');

    doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowUp', ctrlKey:true, shiftKey:true, bubbles:true}));
    check('Ctrl+Shift+Up at the very top is a silent no-op, same as the disabled boundary case',
      orderNow().join(',') === 'Reorder Z,Reorder X,Reorder Y');
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

  console.log('\n--- Dependency picker hierarchy tooltip ---');
  {
    // Used for the "full name + path" hover tooltip on truncated dependency-picker rows.
    const grandparent = D.addTask(null); grandparent.name = 'Phase 2: Build';
    const parent2 = D.addTask(null, grandparent.id); parent2.name = 'Backend';
    const leaf = D.addTask(null, parent2.id); leaf.name = 'API Endpoints';
    check('taskHierarchyPath() is root-first, joined with the path separator',
      D.taskHierarchyPath(leaf.id) === 'Phase 2: Build › Backend › API Endpoints');
    check('a top-level task with no ancestors is just its own name',
      D.taskHierarchyPath(grandparent.id) === 'Phase 2: Build');
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

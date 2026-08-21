/**
 * playwright-visual-tests.js
 * ---------------------------------------------------------------------------
 * Example visual / print-rendering test harness for timeline-schedule-tool.html.
 *
 * jsdom (see jsdom-functional-tests.js) is fast and great for logic, but it
 * doesn't do real layout or apply @media print — it can't tell you whether
 * something actually looks right, or whether a print stylesheet is actually
 * taking effect. This harness uses a real, headless Chromium via Playwright
 * to check things jsdom fundamentally can't:
 *
 *   - Real rendering: screenshotting a populated Gantt chart and Dashboard.
 *   - Real print behavior: emulating print media and generating an actual
 *     PDF, then checking that colors/backgrounds are present. This exact
 *     class of check is what caught a real bug during development — browsers
 *     don't print background colors by default, which silently stripped the
 *     progress-bar fills and milestone markers from printed output even
 *     though the on-screen page and the print HTML/CSS both looked correct.
 *
 * This is standalone dev tooling, not something the app depends on or ships
 * with — the app itself has zero dependencies by design.
 *
 * Requirements (dev-only):
 *   npm install playwright
 *   npx playwright install chromium   (downloads a headless browser binary)
 *
 * Run:
 *   node tests/playwright-visual-tests.js
 *
 * Produces PNG/PDF artifacts in tests/output/ so you can eyeball the result,
 * and exits non-zero if any check fails.
 * ---------------------------------------------------------------------------
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP_PATH = path.join(__dirname, '..', 'timeline-schedule-tool.html');
const OUT_DIR = path.join(__dirname, 'output');

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
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  page.on('dialog', dialog => dialog.accept('Visual Test Schedule'));

  await page.goto('file://' + APP_PATH);
  await page.waitForTimeout(300);
  await page.click('#btn-new-welcome');
  await page.waitForTimeout(300);

  // Build a small representative schedule directly through the app's own
  // functions, exactly as the app itself would when a user edits a task.
  await page.evaluate(() => {
    const design = state.tasks[0];
    design.name = 'Design'; design.duration = 4; design.resources = ['Alice']; design.percentComplete = 60;

    const approved = addTask(null);
    approved.name = 'Design Approved';
    approved.duration = 0; // milestone
    approved.predecessors = [{id: design.id, lag: 0}];

    const build = addTask(null);
    build.name = 'Build';
    build.duration = 6;
    build.predecessors = [{id: approved.id, lag: 0}];
    build.resources = ['Bob'];

    recalcAll();
    renderAll();
  });

  console.log('\n--- Gantt chart rendering ---');
  {
    await page.click('.tab-btn[data-tab="gantt"]');
    await page.waitForTimeout(300);
    const barCount = await page.locator('.g-bar').count();
    const milestoneCount = await page.locator('.g-milestone').count();
    check('Gantt chart renders a bar for each non-milestone task', barCount === 2);
    check('Gantt chart renders a diamond marker for the milestone', milestoneCount === 1);
    // the {id, lag} predecessor shape actually took effect (catches the plain-id-string
    // regression this test itself once had silently, since bar/milestone counts alone don't
    // depend on the dependency chain having scheduled correctly)
    const datesInOrder = await page.evaluate(() => {
      const design = state.tasks.find(t=>t.name==='Design');
      const approved = state.tasks.find(t=>t.name==='Design Approved');
      const build = state.tasks.find(t=>t.name==='Build');
      return approved.start > design.end && build.start > approved.start;
    });
    check('dependency chain actually scheduled (each task starts after its predecessor)', datesInOrder);
    await page.screenshot({ path: path.join(OUT_DIR, 'gantt-chart.png') });
  }

  console.log('\n--- Gantt: collapsed-row milestone rollup ---');
  {
    // A milestone inside a collapsed subtree should still show (rolled up onto the collapsed
    // summary row) with its dependency arrow still drawn, not just vanish.
    await page.evaluate(() => {
      const phase = addTask(null); phase.name = 'Phase X';
      const kickoff = addTask(null, phase.id); kickoff.name = 'Kickoff X'; kickoff.duration = 2;
      const hiddenMilestone = addTask(null, phase.id); hiddenMilestone.name = 'Hidden Milestone';
      hiddenMilestone.duration = 0;
      hiddenMilestone.predecessors = [{id: kickoff.id, lag: 0}];
      const external = addTask(null); external.name = 'External Follow-up';
      external.predecessors = [{id: hiddenMilestone.id, lag: 0}];
      recalcAll();
      renderAll();
      // collapse Phase X
      phase.collapsed = true;
      renderAll();
    });
    await page.waitForTimeout(300);
    const rolledUpMarker = await page.locator('.g-milestone.collapsed-hidden').count();
    check('the hidden milestone gets a rolled-up marker on the collapsed row', rolledUpMarker === 1);
    const arrowCount = await page.locator('#dep-svg path').count();
    // +1 for the <path> inside the arrowhead <marker> definition
    check('its dependency arrow to the external task still draws', arrowCount >= 2);
    await page.screenshot({ path: path.join(OUT_DIR, 'gantt-collapsed-milestone.png') });
  }

  console.log('\n--- Task List: date field keeps focus through a rapid same-field change burst (#19) ---');
  {
    // Reproduces the actual mechanism behind #19 ("editing a date loses focus too quickly"),
    // not the flaky native segment-typing symptom itself: a single keystroke into a native
    // date input's segment can fire two 'change' events back to back, with the browser
    // blurring the field to <body> in between, before the app's own code runs at all. Each
    // 'change' used to schedule its own independent deferred rebuild+maybe-refocus; whichever
    // one ran last decided the outcome, and it could see the field already blurred and
    // (correctly, by its own stale information) decline to refocus — destroying the row a
    // second time right after the first rebuild had just fixed it. This drives that exact
    // burst directly (real native date-input segment typing isn't reliable to simulate
    // headlessly) and checks that only one net rebuild results, with focus correctly restored.
    await page.click('.tab-btn[data-tab="tasks"]');
    await page.waitForTimeout(200);
    const result = await page.evaluate(async () => {
      const t = state.tasks[0];
      const input = document.querySelector(`tr[data-id="${t.id}"] input[data-field="start"]`);
      input.focus();
      let rebuildCount = 0;
      const origRenderAll = window.renderAll;
      window.renderAll = function(...args){ rebuildCount++; return origRenderAll.apply(this, args); };

      // First 'change': still focused (matches the real first event).
      input.value = '2026-09-01';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // Between the two native events, the browser itself blurs the field to <body> — reproduced
      // directly here rather than relying on headless Chromium's flaky native segment-typing.
      document.body.focus();
      // Second 'change' on the same (still-original, not-yet-rebuilt) input, immediately after.
      input.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise(r => setTimeout(r, 50)); // let the coalesced deferred commit settle
      window.renderAll = origRenderAll;

      const fresh = document.querySelector(`tr[data-id="${t.id}"] input[data-field="start"]`);
      return {
        rebuildCount,
        focusedOnDateField: document.activeElement === fresh,
        value: fresh ? fresh.value : null,
      };
    });
    check('a same-field change burst triggers exactly one rebuild, not one per event', result.rebuildCount === 1);
    check('focus lands back on the date field, not stranded on <body>', result.focusedOnDateField);
    check('the committed value is the real one, not an intermediate/partial one', result.value === '2026-09-01');
    // The Print test below expects the Gantt tab active (printing opens a popup only in that
    // case — see #btn-print's click handler) — restore it since this test switched to Task List.
    await page.click('.tab-btn[data-tab="gantt"]');
    await page.waitForTimeout(200);
  }

  console.log('\n--- Print rendering (the check that actually caught a real bug) ---');
  {
    // Trigger the Gantt print flow the same way a user clicking "Print / PDF" would,
    // and capture the popup window it opens.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.click('#btn-print')
    ]);
    await popup.waitForLoadState();
    await popup.waitForTimeout(300);

    const pdfPath = path.join(OUT_DIR, 'gantt-print.pdf');
    await popup.pdf({ path: pdfPath, format: 'A4', landscape: true }); // no forced "print background" flag —
                                                                          // matches a real user's default settings
    check('print PDF was generated', fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0);

    // The actual regression check: without `print-color-adjust: exact` in the
    // print stylesheet, browsers silently drop background colors by default,
    // which is how the progress fills and milestone markers disappeared during
    // development despite the layout itself being correct. Confirm the CSS
    // property that fixes this is present in what actually got printed.
    const hasColorAdjust = await popup.evaluate(() => {
      const styleText = document.querySelector('style')?.textContent || '';
      return styleText.includes('print-color-adjust');
    });
    check('print stylesheet forces background colors to print (the fix for a real found bug)', hasColorAdjust);

    await popup.close();
  }

  console.log('\n--- Dashboard rendering ---');
  {
    await page.click('.tab-btn[data-tab="dashboard"]');
    await page.waitForTimeout(300);
    const cardCount = await page.locator('.dash-card').count();
    check('Dashboard renders status + per-person cards', cardCount > 0);
    await page.screenshot({ path: path.join(OUT_DIR, 'dashboard.png') });
  }

  await browser.close();

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  console.log(`Artifacts written to ${OUT_DIR}\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('TEST HARNESS CRASHED:', err);
  process.exit(1);
});

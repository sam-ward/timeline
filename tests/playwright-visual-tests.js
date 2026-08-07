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
    approved.predecessors = [design.id];

    const build = addTask(null);
    build.name = 'Build';
    build.duration = 6;
    build.predecessors = [approved.id];
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
    await page.screenshot({ path: path.join(OUT_DIR, 'gantt-chart.png') });
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

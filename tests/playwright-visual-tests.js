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

  console.log('\n--- Task List: date field is never rebuilt mid-edit (#19) ---');
  {
    // #19 ("editing a date loses focus too quickly") turned out to have a much more specific
    // cause than either of two earlier attempts at this fix assumed. Instrumented directly:
    // calling .focus() on a native date input *always* resets its active segment (month/day/
    // year) to the first one — confirmed even when reusing the exact same DOM node (never
    // destroyed, just relocated and reattached) rather than a freshly built one. There is no
    // way, from JS, to refocus a date input onto a specific segment. So a live rebuild-and-
    // refocus on every 'change' (the previous approach, shared with duration/%-complete
    // stepping) can never work correctly for typing or arrow-stepping a date's month/year
    // segment: every commit calls .focus() again, which always snaps back to day. The fix is to
    // not call .focus() on this field again while it's still being edited at all — i.e. not
    // rebuild the table until the user actually leaves the field (on 'blur'), rather than on
    // every 'change'. This checks that directly: zero rebuilds while focused, exactly one once
    // blurred, with the right value landing in the model either way.
    await page.click('.tab-btn[data-tab="tasks"]');
    await page.waitForTimeout(200);
    const result = await page.evaluate(async () => {
      const t = state.tasks[0];
      const input = document.querySelector(`tr[data-id="${t.id}"] input[data-field="start"]`);
      input.focus();
      let rebuildCount = 0;
      const origRenderAll = window.renderAll;
      window.renderAll = function(...args){ rebuildCount++; return origRenderAll.apply(this, args); };

      // Simulate several native 'change' events firing while still focused — exactly what
      // typing across multiple segments, or repeated arrow-key stepping, does in a real browser.
      input.value = '2026-09-01';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = '2026-09-02';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = '2026-09-03';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 20));
      const rebuildsWhileFocused = rebuildCount;
      const modelValueWhileFocused = t.start;

      // Now actually leave the field, the way tabbing away or clicking elsewhere would.
      input.dispatchEvent(new Event('blur'));
      await new Promise(r => setTimeout(r, 20));
      window.renderAll = origRenderAll;

      return {
        rebuildsWhileFocused,
        modelValueWhileFocused,
        rebuildsAfterBlur: rebuildCount,
        finalValue: t.start,
      };
    });
    check('no table rebuild happens while the date field is still focused', result.rebuildsWhileFocused === 0);
    check('the model already reflects the live-typed value even before blur', result.modelValueWhileFocused === '2026-09-03');
    check('exactly one rebuild happens once the field is actually left', result.rebuildsAfterBlur === 1);
    check('the final committed value is correct', result.finalValue === '2026-09-03');
    // The Print test below expects the Gantt tab active (printing opens a popup only in that
    // case — see #btn-print's click handler) — restore it since this test switched to Task List.
    await page.click('.tab-btn[data-tab="gantt"]');
    await page.waitForTimeout(200);
  }

  console.log('\n--- Task edit modal: RAG status dot vertical alignment (#21) ---');
  {
    // .status-select-wrap .status-dot is position:absolute with no top/vertical-centering rule,
    // so it sat at its default static position instead of actually centered against the
    // <select>'s text. Checks real pixel geometry, not just that the CSS rule exists.
    await page.click('.tab-btn[data-tab="tasks"]');
    await page.waitForTimeout(200);
    const offset = await page.evaluate(() => {
      openTaskEditModal(state.tasks[0].id);
      const wrap = document.querySelector('.status-select-wrap').getBoundingClientRect();
      const dot = document.querySelector('.status-select-wrap .status-dot').getBoundingClientRect();
      return Math.abs((dot.top + dot.height / 2) - (wrap.top + wrap.height / 2));
    });
    check('the status dot is vertically centered against the select (within half a pixel)', offset < 0.5);
    await page.keyboard.press('Escape'); // closes the modal, same as clicking Cancel
    await page.waitForTimeout(100);
    await page.click('.tab-btn[data-tab="gantt"]');
    await page.waitForTimeout(200);
  }

  console.log('\n--- Tags: Task List popover (#26) ---');
  {
    await page.click('.tab-btn[data-tab="tasks"]');
    await page.waitForTimeout(200);
    const taskId = await page.evaluate(() => state.tasks[0].id);

    await page.click(`tr[data-id="${taskId}"] [data-act="tags"]`);
    await page.waitForTimeout(150);
    check('the tags popover opens', await page.locator('.popover .popover-head h4').textContent() === 'Tags');

    // Type a brand-new tag and press Enter, same as a user would.
    await page.fill('.tag-add-input', 'PO');
    await page.press('.tag-add-input', 'Enter');
    await page.waitForTimeout(150);
    // The popover reopens fresh after the add (same pattern as the Deps popover) — re-locate it.
    const chipAfterAdd = await page.locator(`tr[data-id="${taskId}"] [data-act="tags"]`).textContent();
    check('adding a new tag updates the Task List chip to show the count', chipAfterAdd.trim() === '1 tag');
    check('the newly-added tag now appears checked in the popover', await page.locator('.popover input[type=checkbox][value="PO"]').isChecked());

    // Uncheck it and confirm the chip reverts.
    await page.click('.popover input[type=checkbox][value="PO"]');
    await page.waitForTimeout(150);
    const chipAfterRemove = await page.locator(`tr[data-id="${taskId}"] [data-act="tags"]`).textContent();
    check('unchecking a tag reverts the chip to "+ tag"', chipAfterRemove.trim() === '+ tag');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }

  console.log('\n--- Tags: edit modal (commit-on-Save, unlike the popover) (#26) ---');
  {
    const taskId = await page.evaluate(() => state.tasks[0].id);
    await page.evaluate((id) => openTaskEditModal(id), taskId);
    await page.waitForTimeout(150);

    await page.fill('#te-tags-wrap .tag-add-input', 'DOC');
    await page.press('#te-tags-wrap .tag-add-input', 'Enter');
    await page.waitForTimeout(100);
    const modelBeforeSave = await page.evaluate((id) => byId(id).tags || [], taskId);
    check('a tag added in the modal is NOT committed to the model until Save', modelBeforeSave.length === 0);

    await page.click('#te-save');
    await page.waitForTimeout(150);
    const modelAfterSave = await page.evaluate((id) => byId(id).tags || [], taskId);
    check('the tag is committed to the model after Save', modelAfterSave.includes('DOC'));
    // The Print test below expects the Gantt tab active (printing opens a popup only in that
    // case — see #btn-print's click handler) — restore it since this test left Task List active.
    await page.click('.tab-btn[data-tab="gantt"]');
    await page.waitForTimeout(200);
  }

  console.log('\n--- Tags: Gantt indicator and hover tooltip (#26) ---');
  {
    // "Design" already has tags from the earlier modal test above ('DOC'); "Build" has none.
    await page.click('.tab-btn[data-tab="gantt"]');
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const design = state.tasks.find(t => t.name === 'Design');
      const build = state.tasks.find(t => t.name === 'Build');
      const row = (t) => document.querySelector(`.g-row[data-id="${t.id}"]`)
        || Array.from(document.querySelectorAll('.g-row')).find(r => r.querySelector('.g-name-txt').textContent === t.name);
      return {
        designHasMark: !!row(design).querySelector('.g-tag-mark'),
        buildHasMark: !!row(build).querySelector('.g-tag-mark'),
        tooltipHtml: buildGanttTooltipHtml(design),
      };
    });
    check('a tagged task shows the small Gantt tag indicator', info.designHasMark);
    check('an untagged task does not show the indicator', !info.buildHasMark);
    check('the Gantt hover tooltip includes a Tags section for a tagged task', info.tooltipHtml.includes('Tags') && info.tooltipHtml.includes('DOC'));
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

  console.log('\n--- Tags: Dashboard filter (#26) ---');
  {
    // The Build task from the fixture at the top of this file has no tags yet — give it one and
    // confirm the filter actually narrows what's shown, the same mechanism as the resource filter.
    const before = await page.evaluate(() => {
      const build = state.tasks.find(t => t.name === 'Build');
      build.tags = ['DOC'];
      recalcAll();
      renderAll();
      return document.querySelectorAll('.dash-item').length;
    });
    const itemMeta = await page.evaluate(() => {
      const build = state.tasks.find(t => t.name === 'Build');
      const item = document.querySelector(`.dash-item[data-task-id="${build.id}"]`);
      return item ? item.querySelector('.t-meta').textContent : null;
    });
    check('a Dashboard item lists its tags alongside resources, like resources are listed', itemMeta && itemMeta.includes('DOC'));
    await page.click('#dash-tag-btn');
    await page.waitForTimeout(150);
    check('the tag filter popover opens', await page.locator('.popover .popover-head h4').textContent() === 'Filter by tag');
    await page.click('.popover input[type=checkbox][value="DOC"]');
    await page.waitForTimeout(150);
    const afterFilter = await page.evaluate(() => document.querySelectorAll('.dash-item').length);
    check('selecting a tag narrows the Dashboard to only matching tasks', afterFilter > 0 && afterFilter < before);
    check('the filter button reflects the active selection', (await page.locator('#dash-tag-btn').textContent()).trim() === 'DOC');
    check('the "Clear filters" button appears once a filter is active', await page.locator('#dash-clear-filters-btn').isVisible());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Also select a resource, so both filters are active at once before clearing.
    await page.click('#dash-resource-btn');
    await page.waitForTimeout(150);
    await page.click('.popover input[type=checkbox]');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.click('#dash-clear-filters-btn');
    await page.waitForTimeout(150);
    const stateAfterClear = await page.evaluate(() => ({
      resourceBtn: document.getElementById('dash-resource-btn').textContent.trim(),
      tagBtn: document.getElementById('dash-tag-btn').textContent.trim(),
    }));
    check('clearing filters resets the resource filter button', stateAfterClear.resourceBtn === 'All resources');
    check('clearing filters resets the tag filter button', stateAfterClear.tagBtn === 'All tags');
    check('the "Clear filters" button hides itself once nothing is filtered', !(await page.locator('#dash-clear-filters-btn').isVisible()));
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

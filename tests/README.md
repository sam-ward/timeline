# Example test harness

This folder is a **reference example**, not a bundled test suite the app depends on. The app itself
(`timeline-schedule-tool.html`) is intentionally dependency-free; nothing in here is required to use
it. These scripts are here because they're genuinely useful if you're extending the app and want a
fast way to check you haven't broken anything, and because they demonstrate the actual approach used
to build and debug it in the first place.

## Two harnesses, two different jobs

| | `jsdom-functional-tests.js` | `playwright-visual-tests.js` |
|---|---|---|
| What it checks | Logic: the scheduling engine, data model, state mutations | Actual rendering: layout, screenshots, print output |
| How | Loads the app into a simulated DOM (jsdom), drives it via its own functions and DOM events | Loads the app into a real headless Chromium browser |
| Speed | Fast (no real browser) | Slower, but sees what a user would actually see |
| Catches | Wrong dates, broken rollups, bad state transitions | Things that *look* right in code but render wrong |

Both matter. A change to the scheduling math is best checked with the jsdom harness. A change to CSS,
layout, or anything print-related needs the Playwright harness: jsdom doesn't do real layout and
doesn't apply `@media print` at all, so it can't tell you whether a print stylesheet is actually
working. That distinction isn't theoretical: the Playwright harness's print-color check
(`playwright-visual-tests.js`) is standing in for a real bug found this way during development.
Browsers don't print CSS background colors by default, which was silently stripping progress bars and
milestone markers out of printed output even though the print HTML and CSS both looked correct on
paper (see `ARCHITECTURE.md` in the repo root for the full story).

## Setup

Both harnesses need Node.js. Install their dependencies (dev-only; these are never loaded by the app
itself):

```bash
npm install jsdom playwright
npx playwright install chromium   # downloads a headless browser binary, only needed once
```

## Running

```bash
node tests/jsdom-functional-tests.js
node tests/playwright-visual-tests.js
```

Both scripts:
- print a checklist of pass/fail results to the console,
- exit with a non-zero status code if anything fails (so they're usable as a CI check or a pre-commit
  hook if you want one),
- read `../timeline-schedule-tool.html` directly; point `APP_PATH` at a different copy if you're
  testing a work-in-progress version.

`playwright-visual-tests.js` also writes screenshots and a sample print PDF to `tests/output/` (not
committed, see `.gitignore`) so you can look at exactly what it saw.

## How they work, if you want to write your own

Both scripts follow the same trick: the app doesn't expose any of its internal functions or state on
`window` for external use (by design; it's not a library, it's a single-purpose tool). Rather than
changing the app to add test hooks, each harness reads the HTML file as plain text and inserts one
extra line right before the closing `</script>` tag, exposing whatever internals that particular test
run needs:

```js
const instrumented = html.replace(
  '</script>',
  `window._debug = { state, byId, recalcAll, /* ...whatever you need... */ };\n</script>`
);
```

This keeps the seam entirely on the test side. The shipped app file is never modified, and there's no
risk of a debug hook accidentally shipping in production. If you're testing something not already in
the `DEBUG_EXPORTS` list in `jsdom-functional-tests.js`, just add the function or variable name to that
list; almost everything in the app is a plain top-level function, so this works for nearly anything
you'd want to inspect.

For the Playwright harness, you don't need this trick as often: `page.evaluate()` runs directly in the
page's own context, so it can call the app's global functions (`addTask`, `recalcAll`, etc.) exactly as
if it were code pasted into the browser console.

## A third script: keeping the verification fixture's dates fresh

`refresh-verification-fixture-dates.js` isn't a test — it keeps `examples/verification-schedule.json`
(the manual-verification fixture, see `examples/README.md`) positioned sensibly relative to today,
shifting every date in the *current* file by a fixed offset rather than regenerating it from scratch,
so real edits made while testing a feature are never thrown away. Runs automatically via the
pre-commit hook if you've enabled it (see `CONTRIBUTING.md`'s "Git hooks" section); run it by hand
anytime with `node tests/refresh-verification-fixture-dates.js`, or `--check` to see whether it would
change anything without writing.

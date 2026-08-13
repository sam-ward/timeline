# Architecture & Developer Guide

This document is for anyone (human or AI) who needs to read, modify, or extend the code in
`timeline-schedule-tool.html`. It assumes no prior context: read this first before touching the
code.

## The big picture

The whole application is **one HTML file**: a `<style>` block, a `<body>` with all the markup, and a
`<script>` block with every line of JavaScript. There is no build step, no bundler, no package.json,
no external script or stylesheet tags, and no framework. This is a deliberate constraint, not an
oversight (see [Why a single file?](#why-a-single-file) below). Any change you make should preserve
this: don't introduce a build step or an external dependency.

There is no automated test suite bundled *inside the HTML file itself* (that would add a runtime
dependency, which defeats the point). There is, however, an example test harness in `tests/`; see
`tests/README.md`. It's dev-only tooling, not something the app loads or depends on, but it's the same
approach used throughout this app's own development to verify changes without a real browser
(`jsdom-functional-tests.js`, for scheduling/data-model logic) and with one
(`playwright-visual-tests.js`, for rendering and print output. jsdom can't apply `@media print` or do
real layout, so it can't catch everything). If you're extending this file, running both before and
after your change is the recommended way to verify you haven't broken anything.

### File layout (line numbers approximate: search for the section header comments)

```
<style>                     All CSS. Organized by area: layout/topbar, task table, popovers,
                             modals, gantt chart, dashboard, print media query.
</style>

<body>
  <div id="app">
    <header id="topbar">     File menu, schedule name/rename, Export, Print
    <nav id="tabs">          Task List / Gantt Chart / Dashboard tab buttons
    <main>
      <div id="welcome">     Shown before a schedule is created/opened
      <section id="view-tasks">      Task List table
      <section id="view-gantt">      Gantt chart
      <section id="view-dashboard">  Dashboard
  <div id="modal-root">       Task edit modal / notes modal / holidays modal render here
  <div id="popover-root">     Deps picker / resource filter popovers render here
  <div id="hover-tooltip">    Shared hover tooltip element

  <script>
    VERSION                      APP_VERSION / GITHUB_REPO constants, see Versioning below
    STATE                        global `state` object, `dirty`, `fileHandle`, etc.
    INPUT BLUR REPAINT WORKAROUND  document-level fix for a browser stale-paint bug, see below
    HOVER TOOLTIP                generic tooltip engine, reused everywhere
    DATE UTILITIES                working-day math (weekends + holidays)
    FILE I/O                     save/open, File System Access API + fallback
    EXPORT                       static HTML export, print-specific Gantt rendering
    TASK TREE HELPERS            byId, hasChildren, isMilestone, ancestor/descendant walks
    SCHEDULING ENGINE            recalcAll(), the heart of the app, see below
    TASK MUTATIONS               addTask, deleteTask, indent/outdent, move up/down
    RENDER: master                renderAll()
    RENDER: TASK TABLE           renderTaskTable() + its event handlers
    POPOVER: dependencies        the deps-picker popover on the Task List
    MODAL: notes                 the notes/description edit popup
    RENDER: GANTT                renderGantt(), the interactive chart
    MODAL: holidays              non-working-day manager
    MODAL: about                 About panel, version display, update check
    RENDER: DASHBOARD            renderDashboard(), classifyTask, taskItemHtml
    TABS                         switchTab()
    TOP TOOLBAR                  all the button click handlers
    INIT                         a couple of startup checks
  </script>
</body>
```

## Data model

Everything lives in one in-memory object, `state`:

```js
state = {
  meta: { name: "My Schedule", created: "<ISO datetime>", modified: "<ISO datetime>" },
  holidays: ["2026-08-31", ...],   // ISO date strings, always excluded from scheduling
  tasks: [ Task, Task, ... ]        // flat array; hierarchy is via parentId, not nesting
}
```

### Task shape

```js
{
  id: "t1a2b3c",              // short random id, see uid()
  name: "Design Approved",
  description: "",             // longer free text, edited via the task edit modal
  notes: "",                   // separate free-text field, same modal
  resources: ["Alice", "Bob"], // array of names; case-canonicalized (see below)
  duration: 0,                 // working days. 0 = milestone (see Milestones below)
  start: "2026-08-10",         // ISO date
  end: "2026-08-10",           // ISO date, normally derived from start+duration
  manualEnd: false,            // if true, `end` is user-set and duration is derived instead
  percentComplete: 60,         // 0-100
  status: "green",             // "green" | "amber" | "red" | null, see Status below
  predecessors: ["t9x8y7z"],   // array of task ids this task depends on (finish-to-start)
  parentId: null,              // task id, or null for a top-level task
  collapsed: false             // Task List / Gantt UI state: whether children are hidden
}
```

Tasks are stored **flat** in `state.tasks`; the tree structure is entirely reconstructed on demand
from `parentId`. There is no nested-children array anywhere. See `flattenVisible()` (Task List),
`collectAllFlattened()` (export/print), and `childrenOf()` / `rootTasks()` for how the tree gets
walked.

### Status (RAG)

A task's `status` is `"green"`, `"amber"`, `"red"`, or `null` ("not set"), a simple manual
red/amber/green indicator, independent of everything else on the task. `sanitizeStatus(raw)` is the
single validator (anything else collapses to `null`), and `nextStatus(current)` implements the
Task List's click-to-cycle order (`null → green → amber → red → null`). `statusDotHtml(status, opts)`
is the one shared function that renders the colored dot everywhere it appears: Task List, Gantt
(both the live view and the export/print renderer), Dashboard cards, and the Gantt hover tooltip.
Pass `opts.clickable` and `opts.taskId` for the Task List's interactive version.

The colors reuse existing variables (`--accent` for green, `--warn` for amber, `--danger` for red)
rather than introducing new ones, the same variables already used elsewhere (today-marker, overdue
rows). This was a deliberate choice to avoid introducing a fourth color meaning into the palette and
to get dark-mode support for free, at the cost of `--warn`/`--danger` now carrying two slightly
different meanings depending on context (there wasn't a Task List/Gantt case in testing where this
read as confusing, but keep it in mind if you're ever asked to give Status its own distinct hues).

Status is edited via a `<select>` dropdown in the task edit modal (`#te-status`), styled with the
current color as a small dot overlaid on the closed control; see `.status-select-wrap` in the CSS.
**Gotcha if you touch this again:** the milestone completion toggle used to be labeled "Status" in
that same modal (a checkbox for "is this milestone done"). It was renamed to **"Progress"** when the
Status field was added, specifically to avoid two same-named fields sitting in the same form. If you
ever see "Status" and a checkbox together in the modal, that's the bug this avoided.

Status is deliberately **not** locked for parent/summary tasks or for milestones. Unlike almost every
other field, a manager might reasonably want to flag a whole phase, or a milestone itself, as at-risk,
so `rollupLocked` and `isMilestone(t)` are never checked before reading/writing `t.status`.

### Milestones: a convention, not a separate type

A task **is** a milestone if `duration === 0`. There's no `isMilestoneFlag` boolean field; this was a
intentional simplification, since duration and milestone-ness are inherently linked (a milestone is a
task with zero span). `isMilestone(t)` is the single source of truth:

```js
function isMilestone(t){ return t && t.duration === 0; }
```

Two invariants are enforced defensively at the top of every `recalcAll()` pass (see
`clearMilestoneResources()`): a milestone always has `resources: []`, and (via `addWorkingDays`) its
`end` always equals its `start`. Parent/summary tasks are *never* treated as milestones for rendering
purposes even if their rolled-up span happens to be zero days; see the `!isParent &&` guards
wherever `isMilestone()` is checked in the render code. The Dashboard's virtual "Unassigned" bucket
also explicitly excludes milestones (`!isMilestone(t)`). A milestone can never have resources by
definition, so listing it there would read as "forgot to assign someone" rather than what it actually
is.

### Parent (summary) tasks

Any task that has at least one other task pointing `parentId` at it becomes a summary row. Its own
`start`, `end`, `duration`, `percentComplete`, and `resources` fields get **overwritten** every
`recalcAll()` pass by a rollup of its children (min start, max end, duration-weighted average
percent, union of resources). The UI disables editing these fields directly on a parent row; see
`hasChildren(t.id)` checks throughout `renderTaskTable()` and `openTaskEditModal()`.

## The scheduling engine: `recalcAll()`

This is the most important function in the codebase. Everything that changes a task's data calls
`recalcAll()` before re-rendering. It does two things, in a loop:

1. **Normalize.** Three defensive passes run once at the very start of every call, each fixing up
   data that could have drifted into an invalid state (from direct edits, or from loading an older
   file):
   - `stripCircularPredecessors()`: a task can never depend on one of its own ancestors (that would
     make the ancestor's rollup depend on the task's own schedule, which depends on the ancestor;
     an infinite feedback loop). See the [circular-dependency note](#why-cant-a-task-depend-on-its-own-ancestor)
     below for why this exists.
   - `canonicalizeResourceCasing()`: resource names are matched case-insensitively ("Joe" and "joe"
     are the same person). Whichever casing appeared first wins, with a slight preference for a
     capitalized version.
   - `clearMilestoneResources()`: any milestone's `resources` array gets forced to `[]`.

2. **Iterate to a fixed point** (capped at 12 passes; real schedules converge in 1-3):
   - For every **leaf** task (no children): compute `start` from its predecessors' latest `end` (+1
     working day) if it has any, else leave `start` as-is; then compute `end` from `start + duration`
     via `addWorkingDays()`, or, if `manualEnd` is set, derive `duration` from the `start`/`end`
     range instead via `countWorkingDays()`.
   - For every **parent** task (deepest first): roll up `start`/`end`/`percentComplete`/`resources`
     from its children.
   - Repeat until nothing changed in a full pass.

This relaxation approach (rather than a strict topological sort) was chosen because it naturally
handles the interplay between predecessor chains and parent rollups without needing to reason about a
combined dependency graph. A leaf's predecessor might be a parent task, whose own date depends on
*its* children, which might depend on tasks in another branch entirely. Iterating to a fixed point
handles all of that uniformly, at the cost of (bounded, cheap) repeated passes.

### Working-day math

- `isWorkingDay(date)`: false for weekends or any date in `state.holidays`.
- `addWorkingDays(startISO, duration)`: the core "how do I compute an end date" function. Special
  case: `duration === 0` returns the (normalized) start date unchanged. That's what makes a milestone
  a single point rather than a one-day bar.
- `countWorkingDays(startISO, endISO)`: the reverse. Given a date range, how many working days does
  it span. Used when `manualEnd` is set.
- `sanitizeDuration(raw)`: parses a duration value, allowing an explicit `0` (unlike a naive
  `Number(x) || 1` pattern, which would silently treat `0` as falsy and reset it to `1`). An empty or
  missing value falls back to `1`, not `0`; clearing a field shouldn't accidentally create a
  milestone.

### Why can't a task depend on its own ancestor?

If a task depends on one of its own parents (directly or transitively), you get a genuine circular
calculation: the parent's `end` is computed as the max of its children's `end` dates (rollup), but the
child's `start` is computed as "the day after its predecessor (the parent) finishes." Each
`recalcAll()` pass would push both dates further into the future, forever. This was an actual bug
found during development, `eligiblePredecessorIds()` now excludes a task's own ancestors from the
dependency picker UI, and `stripCircularPredecessors()` cleans up any such link defensively (e.g. if a
sibling task is indented to become a child of a task it already depended on).

## Versioning & the About panel

`APP_VERSION` (top of the `<script>` block, `VERSION` section) is the single source of truth for the
app's current version, using semantic versioning (`MAJOR.MINOR.PATCH`, no leading `v`). It's baked into
the file, not computed, since there's no build step to inject it at. See `CONTRIBUTING.md` for the
release process that bumps it (a GitHub Actions workflow verifies the tag being released matches this
constant before publishing, so the two can't drift silently).

The ℹ️ button in the header (`#btn-about`) opens `openAboutModal()`, a standard modal (same
`.modal-backdrop`/`.modal` markup as the holidays modal) showing the current version, a link to the
GitHub repo (`GITHUB_REPO`, also defined in the `VERSION` section), and the license. On open, it also
calls `checkForUpdate()`, which does a best-effort `fetch()` against the GitHub Releases API
(`GET /repos/{GITHUB_REPO}/releases/latest`) and compares the latest tag against `APP_VERSION` via
`compareSemver()`, showing a link to the newer release if one exists. This is genuinely best-effort:
any failure (offline, blocked by CORS/an ad blocker, rate-limited, opened from a sandboxed/local
context that blocks the request) is caught and silently leaves the status line blank rather than
showing an error. Checking for updates is a "nice to know," not something the app depends on to
function, and it must never block or break opening the About panel itself.

## Theming

The whole app is styled through CSS custom properties defined once in `:root` (`--paper`, `--canvas`,
`--accent`, `--text`, etc.; see the top of the `<style>` block). This is what makes dark mode
tractable: most rules reference a variable, not a literal color, so redefining the variable block is
enough to re-theme most of the UI. A handful of colors used to be hardcoded hex values instead,
mostly Gantt-chart-specific ones (bar fill/border, weekend shading, summary-row background) that were
tuned by eye against a light background. Those were pulled out into their own variables
(`--bar-bg`, `--weekend-bg`, `--summary-bg`, etc.) specifically so dark mode could give them real,
separately-tuned values rather than just inverting a filter over the whole page.

There are three theme states, **Light**, **Dark**, **System**, cycled by the 🌓 button
(`#btn-theme`) and persisted in `localStorage` under the key `timeline-theme-preference`.
Implementation:

- **Light** and **Dark** set `data-theme="light"` / `data-theme="dark"` on `<html>`, which a
  `:root[data-theme="dark"]` CSS rule matches to override the variable block.
- **System** removes the `data-theme` attribute entirely, letting a
  `@media (prefers-color-scheme: dark)` rule take over, scoped as
  `:root:not([data-theme="light"])` so it only applies when the user hasn't explicitly forced Light.
- `applyTheme()` in the `THEME` section of the script is the single function that flips the attribute
  and updates the toggle button's icon/label; `getStoredTheme()` reads the saved preference (falling
  back to `'system'`, including if `localStorage` throws, e.g. in private browsing).
- `color-scheme` (the actual CSS property, not a custom one) is set alongside the color variables in
  both the light and dark blocks, so native form controls (the date picker, scrollbars) follow the
  theme too, not just the app's own elements.

**Two intentional exceptions**, both by design decision rather than oversight:

- **Printing is always light.** The print popup (`printGanttChart()`, see above) has always had its
  own small, hand-written, self-contained stylesheet, independent of the main page, so this came for
  free. It's not a coincidence: keep it that way if you touch print again.
- **The static HTML export bakes in whichever theme was active at export time**, rather than
  reacting to the theme of whoever later opens the exported file. `currentThemeVarsCss()` resolves
  every theme variable to its current fixed value via `getComputedStyle()` and appends a `:root{}`
  block after the copied stylesheet in `exportStaticHTML()`, overriding the conditional
  light/dark/media-query logic with fixed values. If you add a new theme-aware variable, add its name
  to the `names` array in `currentThemeVarsCss()` too, or it won't get baked into exports.

If you add a new UI element with its own color: reference an existing variable if one fits, or add a
new one to *all three* places it needs to be defined: the light `:root` block, the
`@media (prefers-color-scheme: dark)` block, and the `:root[data-theme="dark"]` block (the latter two
are currently kept as literal duplicates of each other, not shared via any preprocessor, since there
isn't one), and, if it's Gantt-related, the print popup's own separate `printCss` `:root` block too
(with a fixed light value, since print never changes).

## Rendering

There is no virtual DOM and no diffing. Every render function builds an HTML string and sets
`.innerHTML` on a container. Three views, three top-level render functions, all invoked together by
`renderAll()`:

- `renderTaskTable()` → `#task-tbody`
- `renderGantt()` → `#gantt-content`
- `renderDashboard()` → `#dash-content`

### The blur-commit pattern (important if you add new editable fields)

Early versions of this app called `renderAll()` on every keystroke in a text/number field. Since
`renderTaskTable()` fully replaces the table's DOM, this **stole focus after the first character
typed**, a real bug that came up during development. The fix, and the pattern to follow for any new
editable field: text/number/date fields commit their value on the `change` event (fires on blur), not
`input`. The `input` listener on `#task-tbody` only updates state directly for fields where a full
re-render isn't needed (`name`, which updates Gantt/Dashboard titles live without touching the table)
or gives a cheap visual-only preview (the % progress bar fill, updated live via direct style
manipulation without touching state or re-rendering). See the two listeners on `#task-tbody` in the
`RENDER: TASK TABLE` section for the exact split.

Checkboxes (manual-end toggle, the milestone Done checkbox) don't have this problem: there's no
"typing" to interrupt, so they commit on `change` immediately, same as before.

**Gotcha the pattern above doesn't fully cover: arrow-key stepping.** Committing on `change` avoids
the typing/focus-stealing problem, but `change` doesn't only fire on blur. Arrow-key stepping (or
clicking the native spinner) on a `date`/`number` input fires `change` *while the field is still
focused*. The `#task-tbody` `change` handler's full-table rebuild (`recalcAll()` + `renderAll()`,
deferred via `setTimeout`) destroys and replaces that still-focused input, so a second arrow press has
nothing to land on. A real bug, fixed by capturing `document.activeElement === input` right before the
rebuild and, only if true, refocusing the freshly-rendered replacement afterward. Critically, this must
stay conditional: if the field had already lost focus (a real tab-away/click-elsewhere commit),
refocusing it back would trap the user in a cell they deliberately left. If you add a new field to this
handler that uses a `date`/`number` input, follow the same `stillFocused` capture-and-conditionally-
refocus pattern, not just "commit on change."

### Input blur repaint workaround (native browser bug, not app logic)

A single document-level, capture-phase `'blur'` listener (`blur` doesn't bubble, hence capture; see
the `INPUT BLUR REPAINT WORKAROUND` section near the top of the script) works around a real browser
rendering bug, confirmed on both Chrome and Firefox, on both Windows and Linux: after selecting text in
a date/text field (e.g. triple-click to select the whole value, the natural way to copy one) and then
clicking somewhere that isn't itself a text/date field, the field's underlying DOM state is correctly
cleared immediately (`document.activeElement` moves on, `selectionStart`/`selectionEnd` reset to
`null`), but the browser doesn't repaint the field, so the old "selected" highlight stays visibly
painted on screen until something else forces a repaint nearby (e.g. focusing a different field).
Confirmed via a real headless-Chromium screenshot: DOM state clean, pixels stale.

Several generic repaint nudges were tried and screenshotted before finding one that actually works.
Toggling `opacity`, `transform`, `display`, and `disabled` all failed to clear it, which suggests the
native control's selection highlight lives in its own paint/compositing layer that those don't
invalidate. What does work: momentarily clearing and restoring the field's own `.value`, which forces
the control to fully redraw its internal text representation from scratch. Programmatic `.value`
assignment never fires `input`/`change`, so this has no effect on the app's own data flow. The listener
is deliberately scoped to text-like inputs only. It skips checkboxes/radios (no such visual exists for
them) and `<select>` (reassigning its value to `''` would risk a visible flash of "nothing selected"
before being restored).

If you're debugging what looks like a stale/incorrect visual on an input and the underlying state is
already correct, this workaround (or the lack of an equivalent one on a new kind of control) is worth
checking before assuming it's a data bug.

**Gotcha the pattern above doesn't fully cover: arrow-key stepping.** Committing on `change` avoids
the typing/focus-stealing problem, but `change` doesn't only fire on blur. Arrow-key stepping (or
clicking the native spinner) on a `date`/`number` input fires `change` *while the field is still
focused*. The `#task-tbody` `change` handler's full-table rebuild (`recalcAll()` + `renderAll()`,
deferred via `setTimeout`) destroys and replaces that still-focused input, so a second arrow press has
nothing to land on. A real bug, fixed by capturing `document.activeElement === input` right before the
rebuild and, only if true, refocusing the freshly-rendered replacement afterward. Critically, this must
stay conditional: if the field had already lost focus (a real tab-away/click-elsewhere commit),
refocusing it back would trap the user in a cell they deliberately left. If you add a new field to this
handler that uses a `date`/`number` input, follow the same `stillFocused` capture-and-conditionally-
refocus pattern, not just "commit on change."

### Input blur repaint workaround (native browser bug, not app logic)

A single document-level, capture-phase `'blur'` listener (`blur` doesn't bubble, hence capture; see
the `INPUT BLUR REPAINT WORKAROUND` section near the top of the script) works around a real browser
rendering bug, confirmed on both Chrome and Firefox, on both Windows and Linux: after selecting text in
a date/text field (e.g. triple-click to select the whole value, the natural way to copy one) and then
clicking somewhere that isn't itself a text/date field, the field's underlying DOM state is correctly
cleared immediately (`document.activeElement` moves on, `selectionStart`/`selectionEnd` reset to
`null`), but the browser doesn't repaint the field, so the old "selected" highlight stays visibly
painted on screen until something else forces a repaint nearby (e.g. focusing a different field).
Confirmed via a real headless-Chromium screenshot: DOM state clean, pixels stale.

Several generic repaint nudges were tried and screenshotted before finding one that actually works.
Toggling `opacity`, `transform`, `display`, and `disabled` all failed to clear it, which suggests the
native control's selection highlight lives in its own paint/compositing layer that those don't
invalidate. What does work: momentarily clearing and restoring the field's own `.value`, which forces
the control to fully redraw its internal text representation from scratch. Programmatic `.value`
assignment never fires `input`/`change`, so this has no effect on the app's own data flow. The listener
is deliberately scoped to text-like inputs only. It skips checkboxes/radios (no such visual exists for
them) and `<select>` (reassigning its value to `''` would risk a visible flash of "nothing selected"
before being restored).

If you're debugging what looks like a stale/incorrect visual on an input and the underlying state is
already correct, this workaround (or the lack of an equivalent one on a new kind of control) is worth
checking before assuming it's a data bug.

### Two Gantt renderers, one shared geometry function

There are two independent Gantt renderers, and it's worth understanding why:

- **`renderGantt()`**: the interactive, on-screen view. Sized for the current zoom level, stretches
  to fill the visible viewport width, wires up hover tooltips, double-click-to-edit, and dependency
  arrows via inline event bindings.
- **`buildGanttTimelineHtml(opts)`**: a parameterized, DOM-independent version returning `{html,
  width, height}` given explicit `dayWidth`/`rowHeight`/`labelWidth`. This is reused by:
  - `buildStaticGanttHtml()` for the "Export HTML" static snapshot (fixed compact sizing, wrapped in
    a scrollable box).
  - `printGanttChart()` for printing (see below), with sizing computed by
    `computePrintGanttParams()` to fit the chosen date range onto a printed page rather than printing
    whatever zoom level the user happened to be scrolled to.

Both renderers respect `collapsed` via `flattenVisible()`; a parent task's children simply aren't in
the list returned to the renderer. The interactive Gantt (`renderGantt()`) has its own toggle button
(`.g-twisty`, delegated via a `click` listener on `#gantt-scroll` that's careful to `stopPropagation()`
and to bail out of the row's `dblclick`-to-edit handler when the click was on the twisty). It just
flips `t.collapsed` and calls `renderAll()`, identical to the Task List's own toggle. Export and print
intentionally ignore `collapsed` (see `collectAllFlattened()`, ignore-collapse-by-design): a printed
or exported document should always show everything regardless of what happened to be folded away on
screen at that moment.

### Task names: editable value vs. display fallback

A task's `name` can legitimately be an empty string. New tasks start that way (`addTask()`), so the
Task List and edit modal name inputs show `placeholder="New task"` as a hint rather than pre-filling
literal text you'd have to delete. `normalizeTask()` only substitutes the `"Untitled task"` fallback
for a truly missing name (`undefined`/`null`, e.g. a malformed loaded file); an empty string is
treated as a deliberate, valid value and preserved as-is.

Every **read-only** place a name is shown, Gantt labels, Dashboard cards, tooltips, dependency
pickers, the notes-modal header, goes through `displayName(t)` instead of `t.name` directly, so a
blank task still shows as "Untitled task" there rather than an empty label. If you add a new place
that displays a task's name, use `displayName()`, not `t.name`; if you add a new *editable* name
field, bind it to the raw `t.name` (with a placeholder) the same way the two existing ones do.

### Dependency pickers: depth indication and filtering

There are two separate places a user picks dependencies: the Task List's Deps-chip popover
(`openDepsPopover()`) and the edit modal's "Depends on" checklist (built inline in
`openTaskEditModal()`). They share the same `.pop-row` / `.dep-name` / `.dep-date` markup and
CSS, so a change to one visual convention usually needs to be applied to both call sites by hand
(there's no shared row-builder function between them, just shared CSS classes).

Both now indent each option by `depthOf(id) * 14px` on the `.dep-name` span, so a task's position in
the hierarchy is visible at a glance. This was added because a flat alphabetical-ish list made it
hard to tell parent tasks from their own children. Both also render a filter `<input>` above the
option list once there are more than 4 candidates (`options.length > 4`), matched against a
lowercased `data-filter-text` attribute already baked into each row at render time (rather than
re-reading `textContent` on every keystroke); see the `.popover-filter` / `.modal-dep-filter` input
listeners for the (identical, duplicated) filtering logic in each location. The popover version
rebuilds its entire DOM (and loses the filter text) every time a checkbox is toggled, since
`openDepsPopover()` calls itself again to refresh. This is a pre-existing, purposeful simplicity
trade-off, not an oversight.

### Copy/paste for date fields

`<input type="date">` doesn't support reliable cross-browser copy/paste on its own (locale-formatted
display text vs. the underlying ISO value make native paste inconsistent). Rather than depend on the
system clipboard at all, which also needs a permission prompt and doesn't work well from a
`file://`-opened page, dates use a simple **in-memory** "clipboard": a single module-level
`copiedDateValue` variable. A `keydown` listener on `#task-tbody`, scoped to `input[type="date"]`
targets only, intercepts Ctrl/Cmd+C to store `e.target.value` (already the ISO `YYYY-MM-DD` string,
regardless of the browser's display locale) and Ctrl/Cmd+V to write it into whichever date field is
focused and dispatch a synthetic `change` event so the normal blur-commit handling picks it up. It
also best-effort mirrors the value to `navigator.clipboard` for cross-app pasting, but that's a bonus,
not the mechanism the feature actually depends on. The in-memory variable is what makes "copy once,
paste into several rows in a row" reliable for bulk schedule entry.

If you change how bars, milestones, or dependency arrows are drawn, you likely need to update **both**
`renderGantt()` and `buildGanttTimelineHtml()`. They intentionally share the same visual language
(CSS class names) but are separate implementations, since the interactive view has concerns (hover
tooltips, live DOM event binding, viewport-fill-on-resize) that the static one doesn't.

### Printing the Gantt chart: why a separate popup window

Task List and Dashboard printing works the conventional way: an in-page `@media print` stylesheet
toggles which `.view` is visible. The Gantt chart does **not** use this approach; `printGanttChart()`
instead opens a new browser window with a small, self-contained, purpose-built stylesheet and writes
the print-sized chart into it directly.

This was arrived at after a long debugging process, and matters if you're ever tempted to "simplify"
it back: the interactive Gantt view uses `position: sticky` extensively (for on-screen scroll-pinned row
labels and headers), and browsers are well known to handle `position: sticky` unpredictably during
print pagination. In testing, this produced garbled, overlapping output specifically in the print
pass, even though the same content looked fine on screen. Isolating the print content in its own
minimal document, with zero sticky positioning, was what actually fixed it. A second, unrelated bug
was found and fixed at the same time: browsers don't print background colors by default, which made
progress bars, milestone fills, and weekend/today shading disappear. Fixed via
`print-color-adjust: exact` in both the popup's stylesheet and the main page's print media query (so
Task List/Dashboard printing, which uses backgrounds too, doesn't hit the same issue).

If you need to touch Gantt printing again: `computePrintGanttParams()` decides the sizing (clamped
day-column width so the date range fits one landscape page where possible), and the popup's `<style>`
block in `printGanttChart()` is deliberately hand-written and minimal rather than reusing the main
page's stylesheet. Keep it that way.

### Dashboard

`classifyTask(t)` buckets a task into `overdue` / `current` / `upcoming` / `completed` / `null`
(parents return `null`; only leaf tasks are actionable work items). `taskItemHtml(t)` is the single
shared card-renderer used everywhere a task appears on the dashboard (the three status buckets, the
per-person breakdown, and the Unassigned card). If you're changing how a task card looks, this is the
one place to do it. The **Unassigned** card in the "By person" section is a virtual pseudo-person built
inline in `renderDashboard()` (filtering for tasks with an empty `resources` array) rather than a real
entry in `allResources()`; it only appears when no resource filter is active, since it wouldn't mean
anything filtered to a specific person.

## The task edit modal (`openTaskEditModal`)

This is the most stateful piece of UI in the app, a form-style dialog (as opposed to the Task List's
inline row editing) used from the Dashboard and Gantt views. A few things worth knowing if you modify
it:

- **It's reactive within a single open session**, not just on save. Ticking/unticking a dependency
  checkbox immediately locks/unlocks the Start field; typing a Duration of `0` immediately swaps in
  the milestone-style UI (a Done checkbox, a disabled Resources field) without needing to save and
  reopen. Both were real bugs where the modal only reflected the state it was opened with. If you add
  a new field whose availability depends on another field's live value, follow the
  `refreshStartLock()` / `refreshMilestoneUI()` pattern: a small function that reads the *current*
  form state (not the original task object) and updates the DOM, wired to the relevant input's
  `change`/`input` event.
- **Unsaved-changes detection** is done by snapshotting all form field values into a JSON string on
  open (`teSnapshot()`), and comparing again on any close attempt (`teAttemptClose()`). If they differ,
  it confirms before discarding. This is why `readPct()`/`readResources()` exist as small indirection
  functions: the underlying control for % complete swaps between a number input and a checkbox
  depending on milestone state, and the snapshot needs to read whichever is currently present.
- **Escape closes the modal** the same way Cancel does (calls the same `teAttemptClose()`), via a
  `keydown` listener added to `document` on open and explicitly removed on close (`teClose()`). Don't
  forget the `removeEventListener` if you add another exit path, or you'll leak a listener per modal
  open.

## File I/O

- `canUseFS = !!window.showSaveFilePicker` gates on browser support for the File System Access API
  (Chrome/Edge; not Firefox/Safari as of this writing).
- With FS API support: `doSave()` writes directly to a previously-chosen `fileHandle` (no dialog) once
  one exists; the first save, or **Save As**, always opens the native save picker.
- Without it: `downloadJSON(promptForName)` triggers a browser download. `lastDownloadName` is
  remembered so plain **Save** can silently reuse the same filename, while **Save As** always prompts.
  This distinction was added on purpose, after the two buttons were found to behave identically in
  fallback mode.
- `loadFromText(text)` parses and validates a JSON file, runs every task through `normalizeTask()`
  (which fills in defaults for any missing/malformed field, important for forward-compatibility if
  you add new fields later), then calls `recalcAll()` to self-heal anything that's drifted out of a
  valid state (circular deps, resource casing, stale milestone resources) before rendering.

## Common tasks for future changes

**Whenever you add, change, or remove a feature covered below** (a new Task field, a new view, a
new export format, a new visual state), also update `examples/verification-schedule.json`, a
hand-built schedule that exercises every major feature and visual state in one file, meant to be
opened after a change to manually eyeball it across all three views. See `examples/README.md` for
what it currently covers. Treat it the same as the checklists below: if a checklist item applies,
the fixture should demonstrate it too, so it doesn't quietly go stale as a verification aid.

**Adding a new field to the Task schema:**
1. Add it to the object literal in `normalizeTask()` with a sensible default (this is what makes
   older saved files still load correctly).
2. Add an input for it in `renderTaskTable()`'s row template, and wire its `data-field` value into the
   `change`/`input` handlers on `#task-tbody`.
3. Add the same field to `openTaskEditModal()`'s form and its save handler.
4. If it affects scheduling (dates, duration, dependencies), touch `recalcAll()`.
5. If it should show up in tooltips, the Gantt chart, or the Dashboard, check
   `buildGanttTooltipHtml()`, `buildGanttTimelineHtml()`, and `taskItemHtml()`.
6. If it needs a static/print export column too, check `buildStaticTaskListHtml()` and (for the
   print-column-hiding rule) the `nth-child` selectors in the `@media print` block. They hide the
   reorder-controls, Notes, and Actions columns *by position*, so inserting a new Task List column
   shifts those indices and needs updating too (this bit the Status column when it was added).

The Status field (`status` / `sanitizeStatus()` / `statusDotHtml()`, documented above) went through
exactly this checklist and is a reasonable template to copy if you're adding something similar: a
small, independently-set attribute that needs to show up consistently across all four views plus
export.

**Adding a new view/tab:**
Follow the existing `.view` pattern: a `<section class="view" id="view-yourname">`, a tab button with
`data-tab="yourname"`, and register it in `switchTab()`. Print support requires adding your view's id
to the `.view.printing` toggle logic in the Print button handler if you want in-page printing (see the
Gantt exception above if your view has scrolling/sticky content that might need the popup-window
treatment instead).

**Adding a new export format:**
`buildStaticTaskListHtml()`, `buildStaticGanttHtml()`, and `buildStaticDashboardHtml()` are the
existing building blocks for `exportStaticHTML()`, each returns a self-contained HTML string with no
JS and no editable elements. A Mermaid-diagram export was attempted and removed (the output quality
wasn't good enough); if revisiting that idea, note that Mermaid's `gantt` diagrams don't support
multi-level task nesting, partial-percent progress, or resource swimlanes, so it needs real
simplification decisions, not a direct translation.

## Why a single file?

This was a deliberate design constraint from the outset: "minimal / no dependencies and nothing to
install," runnable by double-clicking it. That constraint shapes several decisions that might look
unusual coming from a typical web app codebase:

- No package manager, no `node_modules`, no build step: the file you edit is the file that runs.
- No framework (React, Vue, etc.); all rendering is manual `innerHTML` string-building.
- No CSS framework; all styles are hand-written, using CSS custom properties for the design tokens
  (colors, fonts) defined once in `:root`.
- Persistence is a local file, not a server or database.

If you're extending this and are tempted to reach for a bundler or a UI library: that would change the
fundamental value proposition (open the file, it just works), so think carefully before doing so. If
the file is genuinely outgrowing this approach, that's a valid reason to restructure, just make it a
conscious decision, not an incidental one.

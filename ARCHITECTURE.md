# Architecture & Developer Guide

This document is for anyone (human or AI) who needs to read, modify, or extend the code in
`timeline-schedule-tool.html`. It assumes no prior context; read this first before touching the
code.

## The big picture

The whole application is **one HTML file**: a `<style>` block, a `<body>` with all the markup, and a
`<script>` block with every line of JavaScript. There is no build step, no bundler, no package.json,
no external script or stylesheet tags, and no framework. This is a deliberate constraint, not an
oversight. See [Why a single file?](#why-a-single-file) below. Any change you make should preserve
this: don't introduce a build step or an external dependency.

There is no automated test suite bundled *inside the HTML file itself* (that would add a runtime
dependency, which defeats the point). There is, however, an example test harness in `tests/`; see
`tests/README.md`. It's dev-only tooling, not something the app loads or depends on, but it's the same
approach used throughout this app's own development to verify changes without a real browser
(`jsdom-functional-tests.js`, for scheduling/data-model logic) and with one
(`playwright-visual-tests.js`, for rendering and print output, since jsdom can't apply `@media print` or do
real layout, so it can't catch everything). If you're extending this file, running both before and
after your change is the recommended way to verify you haven't broken anything.

### File layout (line numbers approximate; search for the section header comments)

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
    STATE                        global `state` object, `dirty`, `fileHandle`, etc.
    HOVER TOOLTIP                generic tooltip engine, reused everywhere
    DATE UTILITIES                working-day math (weekends + holidays)
    FILE I/O                     save/open, File System Access API + fallback
    EXPORT                       static HTML export, print-specific Gantt rendering
    TASK TREE HELPERS            byId, hasChildren, isMilestone, ancestor/descendant walks
    SCHEDULING ENGINE            recalcAll() — the heart of the app, see below
    TASK MUTATIONS               addTask, deleteTask, indent/outdent, move up/down
    RENDER: master                renderAll()
    RENDER: TASK TABLE           renderTaskTable() + its event handlers
    POPOVER: dependencies        the deps-picker popover on the Task List
    MODAL: notes                 the notes/description edit popup
    RENDER: GANTT                renderGantt() — the interactive chart
    MODAL: holidays              non-working-day manager
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
  tasks: [ Task, Task, ... ]        // flat array — hierarchy is via parentId, not nesting
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
  predecessors: ["t9x8y7z"],   // array of task ids this task depends on (finish-to-start)
  parentId: null,              // task id, or null for a top-level task
  collapsed: false             // Task List UI state — whether children are hidden
}
```

Tasks are stored **flat** in `state.tasks`; the tree structure is entirely reconstructed on demand
from `parentId`. There is no nested-children array anywhere. See `flattenVisible()` (Task List),
`collectAllFlattened()` (export/print), and `childrenOf()` / `rootTasks()` for how the tree gets
walked.

### Milestones: a convention, not a separate type

A task **is** a milestone if `duration === 0`. There's no `isMilestoneFlag` boolean field; this was a
deliberate simplification, since duration and milestone-ness are inherently linked (a milestone is a
task with zero span). `isMilestone(t)` is the single source of truth:

```js
function isMilestone(t){ return t && t.duration === 0; }
```

Two invariants are enforced defensively at the top of every `recalcAll()` pass (see
`clearMilestoneResources()`): a milestone always has `resources: []`, and (via `addWorkingDays`) its
`end` always equals its `start`. Parent/summary tasks are *never* treated as milestones for rendering
purposes even if their rolled-up span happens to be zero days; see the `!isParent &&` guards
wherever `isMilestone()` is checked in the render code.

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
     make the ancestor's rollup depend on the task's own schedule, which depends on the ancestor,
     causing an infinite feedback loop). See the [circular-dependency note](#why-cant-a-task-depend-on-its-own-ancestor)
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
handles the relationship between predecessor chains and parent rollups without needing to reason about a
combined dependency graph: a leaf's predecessor might be a parent task, whose own date depends on
*its* children, which might depend on tasks in another branch entirely. Iterating to a fixed point
handles all of that uniformly, at the cost of (bounded, cheap) repeated passes.

### Working-day math

- `isWorkingDay(date)`: false for weekends or any date in `state.holidays`.
- `addWorkingDays(startISO, duration)`: the core "how do I compute an end date" function. Special
  case: `duration === 0` returns the (normalized) start date unchanged, which is what makes a milestone
  a single point rather than a one-day bar.
- `countWorkingDays(startISO, endISO)`: the reverse: given a date range, how many working days does
  it span. Used when `manualEnd` is set.
- `sanitizeDuration(raw)`: parses a duration value, allowing an explicit `0` (unlike a naive
  `Number(x) || 1` pattern, which would silently treat `0` as falsy and reset it to `1`). An empty or
  missing value falls back to `1`, not `0`, since clearing a field shouldn't accidentally create a
  milestone.

### Why can't a task depend on its own ancestor?

If a task depends on one of its own parents (directly or transitively), you get a circular
calculation: the parent's `end` is computed as the max of its children's `end` dates (rollup), but the
child's `start` is computed as "the day after its predecessor (the parent) finishes." Each
`recalcAll()` pass would push both dates further into the future, forever. This was an actual bug
found during development (see git history / conversation log if available); `eligiblePredecessorIds()`
now excludes a task's own ancestors from the dependency picker UI, and `stripCircularPredecessors()`
cleans up any such link defensively (e.g. if a sibling task is indented to become a child of a task it
already depended on).

## Rendering

There is no virtual DOM and no diffing; every render function builds an HTML string and sets
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
re-render isn't needed (`name`, which updates Gantt/Dashboard titles live without touching the table) or
gives a cheap visual-only preview (the % progress bar fill, updated live via direct style
manipulation without touching state or re-rendering). See the two listeners on `#task-tbody` in the
`RENDER: TASK TABLE` section for the exact split.

Checkboxes (manual-end toggle, the milestone Done checkbox) don't have this problem: there's no
"typing" to interrupt, so they commit on `change` immediately, same as before.

### Two Gantt renderers, one shared geometry function

There are two independent Gantt renderers, and here's why:

- **`renderGantt()`** → the interactive, on-screen view. Sized for the current zoom level, stretches
  to fill the visible viewport width, wires up hover tooltips, double-click-to-edit, and dependency
  arrows via inline event bindings.
- **`buildGanttTimelineHtml(opts)`** → a parameterized, DOM-independent version returning `{html,
  width, height}` given explicit `dayWidth`/`rowHeight`/`labelWidth`. This is reused by:
  - `buildStaticGanttHtml()` for the "Export HTML" static snapshot (fixed compact sizing, wrapped in
    a scrollable box).
  - `printGanttChart()` for printing (see below), with sizing computed by
    `computePrintGanttParams()` to fit the chosen date range onto a printed page rather than printing
    whatever zoom level the user happened to be scrolled to.

If you change how bars, milestones, or dependency arrows are drawn, you likely need to update **both**
`renderGantt()` and `buildGanttTimelineHtml()`: they intentionally share the same visual language
(CSS class names) but are separate implementations, since the interactive view has concerns (hover
tooltips, live DOM event binding, viewport-fill-on-resize) that the static one doesn't.

### Printing the Gantt chart: why a separate popup window

Task List and Dashboard printing works the conventional way: an in-page `@media print` stylesheet
toggles which `.view` is visible. The Gantt chart does **not** use this approach; `printGanttChart()`
instead opens a new browser window with a small, self-contained, purpose-built stylesheet and writes
the print-sized chart into it directly.

This was arrived at after a long debugging process (read this before you're tempted to "simplify" it
back): the interactive Gantt view uses `position: sticky` extensively (for on-screen scroll-pinned row
labels and headers), and browsers are well known to handle `position: sticky` unpredictably during
print pagination; in testing, this produced garbled, overlapping output specifically in the print
pass, even though the same content looked fine on screen. Isolating the print content in its own
minimal document, with zero sticky positioning, was what actually fixed it. A second, unrelated bug
was found and fixed at the same time: browsers don't print background colors by default, which made
progress bars, milestone fills, and weekend/today shading disappear, fixed via
`print-color-adjust: exact` in both the popup's stylesheet and the main page's print media query (so
Task List/Dashboard printing, which uses backgrounds too, doesn't hit the same issue).

If you need to touch Gantt printing again: `computePrintGanttParams()` decides the sizing (clamped
day-column width so the date range fits one landscape page where possible), and the popup's `<style>`
block in `printGanttChart()` is deliberately hand-written and minimal rather than reusing the main
page's stylesheet; keep it that way.

### Dashboard

`classifyTask(t)` buckets a task into `overdue` / `current` / `upcoming` / `completed` / `null`
(parents return `null`; only leaf tasks are units of work). `taskItemHtml(t)` is the single
shared card-renderer used everywhere a task appears on the dashboard (the three status buckets, the
per-person breakdown, and the Unassigned card); if you're changing how a task card looks, this is the
one place to do it. The **Unassigned** card in the "By person" section is a virtual pseudo-person built
inline in `renderDashboard()` (filtering for tasks with an empty `resources` array) rather than a real
entry in `allResources()`; it only appears when no resource filter is active, since it wouldn't mean
anything filtered to a specific person.

## The task edit modal (`openTaskEditModal`)

This is the most stateful piece of UI in the app: a form-style dialog (as opposed to the Task List's
inline row editing) used from the Dashboard and Gantt views. A few things worth knowing if you modify
it:

- **It's reactive within a single open session**, not just on save. Ticking/unticking a dependency
  checkbox immediately locks/unlocks the Start field; typing a Duration of `0` immediately swaps in
  the milestone-style UI (a Done checkbox, a disabled Resources field) without needing to save and
  reopen. Both were real bugs (see conversation history) where the modal only reflected the state it
  was opened with. If you add a new field whose availability depends on another field's live value,
  follow the `refreshStartLock()` / `refreshMilestoneUI()` pattern: a small function that reads the
  *current* form state (not the original task object) and updates the DOM, wired to the relevant
  input's `change`/`input` event.
- **Unsaved-changes detection** is done by snapshotting all form field values into a JSON string on
  open (`teSnapshot()`), and comparing again on any close attempt (`teAttemptClose()`). If they differ,
  it confirms before discarding. This is why `readPct()`/`readResources()` exist as small indirection
  functions: the underlying control for % complete swaps between a number input and a checkbox
  depending on milestone state, and the snapshot needs to read whichever is currently present.
- **Escape closes the modal** the same way Cancel does (calls the same `teAttemptClose()`), via a
  `keydown` listener added to `document` on open and explicitly removed on close (`teClose()`); don't
  forget the `removeEventListener` if you add another exit path, or you'll leak a listener per modal
  open.

## File I/O

- `canUseFS = !!window.showSaveFilePicker` gates on browser support for the File System Access API
  (Chrome/Edge; not Firefox/Safari as of this writing).
- With FS API support: `doSave()` writes directly to a previously-chosen `fileHandle` (no dialog) once
  one exists; the first save, or **Save As**, always opens the native save picker.
- Without it: `downloadJSON(promptForName)` triggers a browser download. `lastDownloadName` is
  remembered so plain **Save** can silently reuse the same filename, while **Save As** always prompts.
  This distinction was added deliberately (see conversation history) after the two buttons were
  found to behave identically in fallback mode.
- `loadFromText(text)` parses and validates a JSON file, runs every task through `normalizeTask()`
  (which fills in defaults for any missing/malformed field, important for forward-compatibility if
  you add new fields later), then calls `recalcAll()` to self-heal anything that's drifted out of a
  valid state (circular deps, resource casing, stale milestone resources) before rendering.

## Common tasks for future changes

**Adding a new field to the Task schema:**
1. Add it to the object literal in `normalizeTask()` with a sensible default (this is what makes
   older saved files still load correctly).
2. Add an input for it in `renderTaskTable()`'s row template, and wire its `data-field` value into the
   `change`/`input` handlers on `#task-tbody`.
3. Add the same field to `openTaskEditModal()`'s form and its save handler.
4. If it affects scheduling (dates, duration, dependencies), touch `recalcAll()`.
5. If it should show up in tooltips, the Gantt chart, or the Dashboard, check
   `buildGanttTooltipHtml()`, `buildGanttTimelineHtml()`, and `taskItemHtml()`.

**Adding a new view/tab:**
Follow the existing `.view` pattern: a `<section class="view" id="view-yourname">`, a tab button with
`data-tab="yourname"`, and register it in `switchTab()`. Print support requires adding your view's id
to the `.view.printing` toggle logic in the Print button handler if you want in-page printing (see the
Gantt exception above if your view has scrolling/sticky content that might need the popup-window
treatment instead).

**Adding a new export format:**
`buildStaticTaskListHtml()`, `buildStaticGanttHtml()`, and `buildStaticDashboardHtml()` are the
existing building blocks for `exportStaticHTML()`: each returns a self-contained HTML string with no
JS and no editable elements. A Mermaid-diagram export was attempted and removed (the output quality
wasn't good enough); if revisiting that idea, note that Mermaid's `gantt` diagrams don't support
multi-level task nesting, partial-percent progress, or resource swimlanes, so it needs real
simplification decisions, not a direct translation.

## Why a single file?

This was a deliberate design constraint from the outset: "minimal / no dependencies and nothing to
install," runnable by double-clicking it. That constraint shapes several decisions that might look
unusual coming from a typical web app codebase:

- No package manager, no `node_modules`, no build step: the file you edit is the file that runs.
- No framework (React, Vue, etc.): all rendering is manual `innerHTML` string-building.
- No CSS framework: all styles are hand-written, using CSS custom properties for the design tokens
  (colors, fonts) defined once in `:root`.
- Persistence is a local file, not a server or database.

If you're extending this and are tempted to reach for a bundler or a UI library: that would change the
fundamental value proposition (open the file, it just works), so think carefully before doing so. If
the file is outgrowing this approach, that's a valid reason to restructure; just make it a
deliberate decision, not an incidental one.

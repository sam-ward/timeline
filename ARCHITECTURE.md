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
  predecessors: [{id: "t9x8y7z", lag: 0}], // finish-to-start deps + lag/lead, see "Dependency lag" below
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

The overlaid dot (`.status-select-wrap .status-dot`) is `position:absolute` so it can sit on top of
the closed `<select>` without affecting layout — but that means it needs its own explicit vertical
centering (`top:50%; transform:translateY(-50%)`), since removing an element from flow via `absolute`
also removes it from its flex container's `align-items:center`. Missing that rule left it about 5.5px
off-center (#21) — worth remembering if this ever needs touching again, since the visual error is
small enough to miss at a glance but confirms cleanly via `getBoundingClientRect()`.

### Tags

`t.tags` is a plain `string[]`, freeform labels for filtering/reporting (e.g. `PO`, `DOC`) with no
separate tag registry — same "spelling is identity" precedent as `resources`, right down to reusing
its exact canonicalization approach: `canonicalizeTagCasing()` is `canonicalizeResourceCasing()`'s
sibling, run defensively at the start of every `recalcAll()`, so a case variant either typed or
loaded from disk (`"PO"` vs `"po"`) collapses to one spelling instead of silently forking the
vocabulary. `allTags()` (mirrors `allResources()`) is the vocabulary offered everywhere tags are
picked from.

Two deliberate differences from `resources`, both from the same reasoning — there's no computed/
derived value to protect the way there is for a parent's dates/resources, so nothing needs
locking:

- **No rollup to parent tasks.** A parent's own `tags` (if set) are untouched by its children's tags,
  unlike `resources`/dates/`percentComplete`, which are recomputed from children on every recalc.
- **Works identically on every task type** — leaf, parent, and milestone — with no `rollupLocked`/
  `isMilestone(t)` gating anywhere, the same reasoning already applied to `status` above.

**UI: a Deps-style popover, not a Resources-style text field — deliberately.** Tags are expected to
be used occasionally for a small recurring vocabulary, not typed fresh per task the way resource
names often are, so the Task List's `.tag-chip` button (styled/behaving exactly like `.dep-chip` —
including reserving a fixed `min-width` for the same `table-layout:auto` reflow-avoidance reason, see
the Deps chip gotcha) opens a checkbox popover (`openTagsPopover()`) listing every tag in
`allTags()`, rather than a free-text comma-separated input. A checkbox list naturally surfaces what's
already in use, so people converge on shared tags instead of near-duplicate free text. The popover
and the edit modal share one rendering function, `renderTagPickerInto(container, holder, onChange)`
— `holder` is anything with a `.tags` array, which is what makes sharing possible despite the two
call sites having different commit timing:

- **Task List popover**: `holder` is the real task `t`, and `onChange` commits live (`markDirty()` +
  `recalcAll()` + `renderAll()` + reopening the popover with fresh state), the same pattern as the
  Deps popover.
- **Edit modal**: `holder` is a throwaway `{tags: [...]}` copy (`pendingTags`), matching the modal's
  "commit only on Save" model used for every other field there (see `pendingDeps` for the same
  pattern applied to dependencies) — `t.tags` is only actually written on Save, and `pendingTags.tags`
  feeds into `teSnapshot()` so Cancel's unsaved-changes prompt sees tag edits too. **Gotcha if you
  touch this again:** `renderTagPickerInto()` replaces its *entire* target's `innerHTML`, so the
  popover passes it a nested `.tag-picker-body` div rather than the `.popover` element itself — doing
  the latter silently wipes out the `.popover-head` (title + close button) sitting next to it. This
  was a real bug caught by a Playwright test, not by inspection.

Adding a brand-new tag not yet in `allTags()` goes through `addTagToTask(holder, rawTag)`, shared by
both the "add" button/Enter-to-add in the picker widget. It trims, no-ops on empty input or a tag
already on that task, and canonicalizes against `allTags()` case-insensitively before adding — so a
new tag typed as a case variant of an existing one is redirected to the existing spelling immediately,
rather than relying on the next `recalcAll()` pass to clean it up after the fact.

**Gotcha: the checkbox row list must be built from `holder.tags` too, not `allTags()` alone (#46).**
`allTags()` scans the *global* vocabulary off `state.tasks` — real, already-committed tasks. In the
edit modal, `holder` is `pendingTags`, an uncommitted local clone (see above), so a tag typed into the
add box lands in `pendingTags.tags` immediately but has no way to reach `state.tasks` — and therefore
`allTags()` — until Save actually writes it back to `t.tags`. Building the row list from `allTags()`
alone meant adding a genuinely new tag in the modal looked like it silently did nothing: no new row,
nothing shown as checked, right up until Save + reopening the modal made it visible for the first
time. `renderTagPickerInto()` now builds the list from `Array.from(new Set([...allTags(),
...(holder.tags||[])]))`, so a tag that only exists on the in-progress holder still renders (checked)
immediately. The Task List popover never hit this, since its `holder` *is* the real task, always
already part of `state.tasks`.

**The add control is a collapsible `+ Add tag…` toggle, not an always-visible input (#47).** Partly to
save space, but mainly because of a real layout bug: the edit modal used to render both the checkbox
list and the "add a tag" input/button into one *outer* scrollable wrapper (`#te-tags-wrap`, its own
`max-height`/`overflow:auto`), while `.popover-rows` (the checkbox list) already scrolls *internally*
at its own smaller `max-height`. Nesting them meant the add row scrolled away along with the list
inside that outer container instead of staying put — something the Task List's own popover never
showed, since there the add row's container has no scroll of its own. Fixed by giving `#te-tags-wrap`
no scroll of its own (only `.popover-rows` scrolls now) and moving the add control into `.tag-add-zone`,
a sibling *below* `.popover-rows`, collapsed behind a `.tag-add-toggle-btn` link by default. Clicking it
swaps in the `.tag-add-row` input/button in place (a local DOM swap, not a call to `onChange()` — that
would recalc/re-render/reopen and immediately re-collapse it); it collapses back to the toggle either
on a successful add or when the input's `blur` fires (clicking elsewhere, tabbing away).

**Gotcha: every listener that swaps `.tag-add-zone`'s own `innerHTML` needs `stopPropagation()` on its
triggering click** — the toggle button's click, and the Add button's click (its `onChange()` rebuilds/
reopens the whole popover, or at least this whole widget in the modal). Without it: the swap detaches
the clicked element from the document while its own click event is still bubbling, so by the time that
event reaches the document-level "outside click" listener that closes an open popover
(`outsideTagsPopoverClick`), `e.target.closest('.popover')` resolves against an already-detached node
and finds nothing — read as a click *outside* the popover, closing the very popover the click was
supposed to be acting on. Same idiom `.tag-add-input`'s own click listener already used, for the same
underlying reason, before this bug existed to make the reason explicit. Separately, the Add button also
needs `mousedown` with `preventDefault()` (not `click`) so it doesn't steal focus from the input before
its own click fires — otherwise the input's `blur` (used to collapse the add row when focus leaves it)
would collapse the row, and remove the button, before the button's `click` handler ever runs.

**Gotcha: the modal's tag list needs a tighter cap than `.popover-rows`'s own default 220px.** That
default is sized for a floating popover, which has nowhere else to put an overflowing list — but the
edit modal is a different situation: `.modal` itself caps at `max-height:86vh; overflow:auto`, and the
Tags field is one of several competing for that budget alongside Name, dates, Deps, Description, Notes,
etc. Without a tighter cap, a task with enough tags could grow the Tags field past what the rest of the
modal has room for, pushing the *whole modal* over its own 86vh cap — at which point the whole thing
(header and footer included) starts scrolling as one unit, instead of just the tag list scrolling
internally the way it's supposed to. `#te-tags-wrap .popover-rows{max-height:100px;}` scopes a smaller
cap to just this context, without touching the popover's own 220px elsewhere. Verified with a Playwright
check that the modal's own height is identical whether it holds 8 tags (already past this cap) or 25 —
growing the tag count well beyond the cap must never grow the modal further.

**Elsewhere a tagged task shows up, deliberately kept lightweight in different ways per surface:**

- **Gantt label row** (`.g-tag-mark`, both `renderGantt()` and the static/export
  `buildGanttTimelineHtml()`): a small 🏷 marker, presence-only — no count, no tag names in the
  label itself (those are in the `title` attribute and the full hover tooltip). Matches
  `.milestone-mark`'s treatment: a small always-there-or-not glyph next to the name, not a chip.
- **Gantt hover tooltip** (`buildGanttTooltipHtml()`): a full "Tags" row, same style as "Resources"
  right above it, only rendered when the task actually has tags (no "none" placeholder the way
  Resources shows "unassigned" — tags having none is the common case, not worth calling out).
- **Dashboard item** (`taskItemHtml()`): tags append to the same `.t-meta` line resources are
  already on (`date · resources · 🏷 tags`), rather than a separate line — keeps every dashboard
  card's item the same height whether or not it happens to have tags.

**Dashboard: `#dash-clear-filters-btn`.** With two independent filters (resource, tag) that combine
as AND, it's easy to leave one active and forget it's still narrowing things after moving on — a
plain reset button next to them, shown only when `dashResourceFilter.length || dashTagFilter.length`
(computed in `renderDashboard()`, same place both filter buttons' labels already get refreshed), so
its own visibility doubles as the "something's filtered" indicator rather than needing a separate one.

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

**Gotcha, and the reason `confirmParentOverwrite()` exists:** the *moment* a childless task gains
its first child, this overwrite kicks in immediately — a task that had a real 5-day duration, 60%
progress, and an assigned resource silently loses all three (the new rollup is derived from a
single fresh empty child: 1-day duration, 0%, no resources) the instant it becomes a parent. This
was a real, reported bug: it happens from the row's "add subtask" (➕) button, and equally from
`indentTask()` when a task is indented underneath a previously-childless sibling (that sibling
becomes the new parent). There's no undo, so both call sites now confirm first via
`confirmParentOverwrite(t)` (`TASK MUTATIONS` section), which no-ops silently if `t` has nothing at
stake (`wouldLoseDataAsParent()`: still on defaults — 1-day duration, 0%, no resources, no manual
end) and otherwise names what would be lost before proceeding. If you add another code path that can
give a task its first child, route it through the same check — the overwrite itself doesn't care how
the child got there, so neither should the warning.

The row also has two separate "add" buttons, `➕` (`add-sibling`, same depth as the clicked row —
`addTask(id)`, no `asChildOf`) and `+` (`add-sub`, current row becomes the parent —
`addTask(null, id)`, goes through the warning above) — the bigger icon on the everyday action
(sibling), the smaller one on the less-common, now-guarded action (sub-task). They used to be one
button that only ever
added a sub-task, which made the destructive path the default outcome of the button everyone reaches
for just to add the next task; splitting it out doesn't fix the overwrite by itself (indenting is
still a path to it) but removes the most common trigger.

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
   - For every **leaf** task (no children): compute `start` from its predecessors' latest resulting
     candidate date (`earliestStartFromPredecessors()` — predecessor's `end` + 1 working day + that
     edge's own `lag`, see "Dependency lag" below) if it has any predecessors, else leave `start`
     as-is; then compute `end` from `start + duration` via `addWorkingDays()`, or, if `manualEnd` is
     set, derive `duration` from the `start`/`end` range instead via `countWorkingDays()`.
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

### Dependency lag

A dependency means "must finish before," which is a different thing from "must start immediately
after" — a task might logically depend on another finishing, but not actually be able to start the
very next working day for reasons that have nothing to do with the task graph itself (an external
vendor, a permit, staff availability). Before this feature, the two were conflated: any predecessor
forced a start of exactly "predecessor's end + 1 working day," with no way to express a gap.

Each entry in a task's `predecessors` array is now `{id, lag}`, not a bare id. `lag` is a signed
integer count of *working days*, applied on top of the usual "day after the predecessor ends" rule:

- `lag: 0` (the default, and what every predecessor implicitly had before this existed) reproduces
  the exact old behavior — start the next working day after the predecessor ends.
- **Positive lag** pushes the start later: `lag: 2` means "wait 2 extra working days after the
  predecessor finishes, then start."
- **Negative lag** is lead time: the successor can start *before* the predecessor is fully finished
  (a deliberate overlap), down to and including the predecessor's own end date. `lag: -1` with a
  1-day predecessor tail means the successor can start the same day the predecessor ends.

The actual math lives in two functions:

- `stepWorkingDays(iso, n)` (DATE UTILITIES): steps `n` working days away from a date, skipping
  weekends/holidays, not counting the starting date itself. `n` may be negative (step backward) or
  zero (returns the date unchanged). `stepWorkingDays(end, 1)` with no lag reproduces the old
  `nextWorkingDayInclusive(addDays(end, 1))` call it replaced — verified by a dedicated jsdom test,
  since silently changing this for the zero-lag case would have broken every schedule saved before
  lag existed.
- `earliestStartFromPredecessors(task)` calls `stepWorkingDays(p.end, 1 + link.lag)` per predecessor
  edge and takes the **latest** resulting candidate date, not simply the latest predecessor `end`.
  With multiple predecessors, each one's own lag is independent — a short lag on the
  later-finishing predecessor can still lose to a longer lag on an earlier-finishing one, so you
  can't shortcut this by finding the max `end` first and applying one lag to it.

No clamping is applied to how early a negative lag can push a start (e.g. against the predecessor's
own start date, or "today"). That's a deliberate choice to keep the feature a flexible tool rather
than a prescriptive one; revisit if it turns out to produce confusing schedules in practice.

**Backward compatibility.** Every schedule saved before this feature stores `predecessors` as a
plain array of id strings (`["t9x8y7z"]`), not `{id, lag}` objects. `normalizePredecessors()` (called
from `normalizeTask()`, so it runs on every load) migrates each string entry to `{id, lag: 0}`
automatically — old files don't need touching on disk, only on load, and old files behave
identically to how they always did since `lag: 0` is a no-op.

### Dependency pickers: the lag UI (Option E)

The Task List's Deps-chip popover and the task edit modal's "Depends on" list (see "Dependency
pickers" above for the base picker they share) both got a lag control added to each checked row,
without changing how unchecked rows look at all. Three layouts were mocked up and compared before
building any of this — a stepper visible on every checked row, a modal-only control with a
read-only badge in the popover, and this one — landing on: a checked row rests as its **date, plus
a small `+Nd`/`-Nd` badge once a non-zero lag is set** (unchanged in size from before this feature
existed for the common zero-lag case); clicking the date or badge reveals an inline **+/- stepper in
the same row** (no added row height); clicking anywhere else collapses it back. Only one row is ever
mid-edit at a time.

The shared pieces (`depRowHtml()`, `depLagRestingHtml()`, `depLagStepperHtml()`,
`wireDepLagInteraction()`) live just above `openDepsPopover()`. `wireDepLagInteraction(container,
{getLag, onLagChange})` is a single delegated click handler bound to the *whole* popover (or the
modal's `.modal-body`) — not just the rows list — specifically so that clicking the popover's own
header/filter box, or a completely different field in the modal, also collapses an open stepper; an
earlier version bound only to the rows container and missed those cases (caught by an end-to-end
Playwright test that clicked the popover's `<h4>` and found the stepper still open).

**Commit timing genuinely differs between the two callers, on purpose** — this is the reason the
event *wiring* isn't shared even though the markup is:

- The **popover** commits every change immediately (checkbox toggle, lag +/-) straight to
  `t.predecessors`, then `recalcAll()` + `renderAll()`, matching how the rest of the popover already
  worked. `renderAll()` never touches `#popover-root`, so this is safe to call while the popover
  itself stays open and mid-edit.
- The **modal** builds a local `pendingDeps` array when it opens (a clone of `t.predecessors`) and
  only writes it back to the real task on **Save** — matching every other field in this modal
  (Cancel discards everything). `teSnapshot()`'s unsaved-changes check includes `pendingDeps` (as
  `"id:lag"` pairs) so a lag-only edit is correctly caught as a change worth confirming before
  discard.

**A lagged dependency needs to be visible from the Task List row itself, not just inside the
popover.** The Deps chip (`data-act="deps"`) gets a small `±` flag whenever any of the task's
predecessors has a non-zero `lag` — found missing during manual testing: the chip's existing hover
tooltip (`buildDepsTooltipHtml()`) already listed the exact lag per predecessor, but there was
nothing to prompt a user to hover in the first place. The flag itself carries no number (a task can
have several predecessors with different lags); it's purely a "look closer" signal, with the
tooltip staying the source of the actual values.

**Gotcha: the Deps chip's width can't vary at all with its own content, or it reflows the whole
table.** The Task List's `<table>` doesn't set `table-layout:fixed`, so every column's width is
computed from content across *every* row, not just the row being changed. A first version of the
lag flag appended a `<span>±</span>` inside the button — visually fine in isolation, but any single
row's Deps chip getting wider than before (by gaining the flag) forced the browser to recompute the
whole table's column widths, visibly shifting the Deps column's left edge (and everything after it)
sideways. Turned out the *same* thing already happened from the dependency **count** alone, lag
aside — "1 dep" -> "2 deps" -> "10 deps" are three different natural widths (measured: ~53px / 58px
/ 64px), so simply checking a second or third dependency shifted the column too, independent of the
flag fix. Fixed both at once by making `.chip-btn.dep-chip` a fixed `min-width:70px` (comfortably
covers up to double-digit dependency counts, `text-align:center`ed inside it) with `padding-right`
always reserved for the flag whether or not one's showing, and the flag itself a `.has-lag::after`
pseudo-element positioned inside that reserved space. The button's box size — and therefore the
column width — is now identical for every row regardless of dependency count or lag state.
Verified with a Playwright check that the chip's `getBoundingClientRect()` is pixel-identical across
0, 1, 2, and 3-dependency (with lag) states on the same row.

**Gotcha: a scrolling `.popover-rows`/`#te-dep-rows` needs padding-right reserved for the
scrollbar, not just visual padding.** Once there are enough candidates to overflow the `max-height`
and force a scrollbar, a classic (non-overlay) scrollbar draws directly on top of the last couple of
characters in the right-aligned `.dep-date` text, since nothing was reserving space for it — the
row's flex layout naturally pushes that text flush to the container's right edge. Fixed with a fixed
`padding-right` (not `scrollbar-gutter: stable`, whose Safari support is recent/inconsistent) on
both `.popover-rows` and the modal's `#te-dep-rows`. Couldn't be verified pixel-for-pixel against a
real classic scrollbar in this project's own dev sandbox, which renders 0-width overlay scrollbars
regardless of `scrollbar-width`/`::-webkit-scrollbar` CSS — the fix is correct by construction
(padding reserves clearance unconditionally) rather than screenshot-verified; flag for a real check
on Windows/Linux Chrome or Firefox if this needs revisiting.

### Reverse dependencies ("Blocks")

`predecessors` only stores the forward edge (a task knows what it depends on; nothing points back).
There's no reverse-edge list kept in sync anywhere, so `dependentsOf(id)` — "every task that depends
on this one" — is a plain scan (`state.tasks.filter(t => (t.predecessors||[]).some(link=>link.id===id))`)
rather than a lookup. Fine at the scale this app deals with; don't reach for a cached/indexed
version unless a real schedule shows it's actually slow.

Surfaced in two places, both read-only (no UI writes to the reverse direction — you still add a
dependency from the *dependent* task's own Deps picker, same as before):
- The Task List's `.blocks-badge` in the name cell (`🔗N`, hover for the full list) — same
  reserved-space-regardless-of-content trick as the Deps chip above (`min-width:34px`, always
  rendered even when empty), for the same table-reflow reason.
- The Gantt hover tooltip (`buildGanttTooltipHtml()`) gets a "Blocks" section, same row style as
  the Deps popover's own listing, whenever `dependentsOf(t.id)` is non-empty.

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
GitHub repo (`GITHUB_REPO`, also defined in the `VERSION` section), and the license.

The update check itself lives in `getUpdateCheck()`, a best-effort `fetch()` against the GitHub
Releases API (`GET /repos/{GITHUB_REPO}/releases/latest`) that compares the latest tag against
`APP_VERSION` via `compareSemver()`. It's memoized to a single promise (`updateCheckPromise`), but
**not as a long-lived cache** — only so a check already in flight (e.g. the background check racing
the panel being opened right at page load) is reused rather than duplicated. Two independent callers
use it: a background check that fires once at load (adding a `.has-update` badge, a small dot via CSS
`::after`, to `#btn-about` if a newer version exists, so the user doesn't have to think to open the
panel to find out) and `openAboutModal()`'s own check when the panel is opened (populating
`#about-update-status` with a link to the newer release, or "You have the latest version.").

**Gotcha: `openAboutModal()` must reset `updateCheckPromise = null` before calling
`getUpdateCheck()`, every time.** Without it, this is a real, shipped bug (found live in `v1.1.0`): a
tab left open across a new release staying stuck reporting "you have the latest version" forever,
because the *result* of the one-off background check from page load was being replayed on every
subsequent panel open rather than re-checked. Opening the panel is a deliberate "check now" action
from the user's point of view; it should never just hand back a possibly-hours-old cached answer.

Opening the panel also clears the badge (`btn-about.classList.remove('has-update')`) immediately, on
the theory that the user has now seen it regardless of whether the check has resolved yet. This is
genuinely best-effort throughout: any failure (offline, blocked by CORS/an ad blocker, rate-limited,
opened from a sandboxed/local context that blocks the request) is caught and resolves to `null` rather
than showing an error or badge. Checking for updates is a "nice to know," not something the app
depends on to function, and it must never block or break opening the About panel itself.

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
re-render isn't needed, or gives a cheap visual-only preview (the % progress bar fill, updated live
via direct style manipulation without touching state or re-rendering). See the two listeners on
`#task-tbody` in the `RENDER: TASK TABLE` section for the exact split.

**`name` is a partial exception, and a second real bug came from getting the split wrong.** The task's
own row already shows every keystroke live for free (it's the same `<input>` the user is typing into),
so `t.name` and `markDirty()` update on every `input` event — that part's cheap. But an earlier version
*also* called `renderGantt()` + `renderDashboard()` on every keystroke here, to keep the task's name
current on Gantt bars/labels and Dashboard cards. Both are full HTML/SVG rebuilds (~400 lines each),
so retyping a name got visibly laggier the larger the schedule got — a real, reported bug. Name now
follows the same commit-on-`change` split as every other field for the *render* half specifically
(data write stays live, render is deferred to blur), which is why it needs its own branch in both
listeners rather than fitting cleanly into either "fully live" or "fully deferred."

Checkboxes (manual-end toggle, the milestone Done checkbox) don't have this problem: there's no
"typing" to interrupt, so they commit on `change` immediately, same as before.

**Gotcha the pattern above doesn't fully cover: arrow-key stepping and date-field segment resets
(#19).** Committing on `change` avoids the typing/focus-stealing problem, but `change` doesn't only
fire on blur. Arrow-key stepping (or clicking the native spinner) on a `duration`/`percentComplete`
input fires `change` *while the field is still focused*. The `#task-tbody` `change` handler's
full-table rebuild (`recalcAll()` + `renderAll()`, deferred via `setTimeout`) destroys and replaces
that still-focused input, so a second arrow press has nothing to land on. Fixed for those two fields
by checking `document.activeElement` right before the rebuild and, only if it's still this field,
refocusing the freshly-rendered replacement afterward — conditional so that a field the user had
already deliberately left (a real tab-away/click-elsewhere commit) doesn't get yanked back into focus.
A shared `pendingFieldCommitTimer` coalesces a same-field burst of `change` events into one net rebuild
rather than stacking independent ones (a native date input's segment editing can fire more than one
`change` per keystroke — see below), and the check treats `document.activeElement === document.body`
the same as still-focused-on-this-field, to recover if the browser itself briefly blurs the field
mid-burst. This whole live-rebuild-and-refocus pattern is still the right one for `duration`/
`percentComplete` (plain single-buffer number inputs — refocusing just resets cursor position, a
minor thing, not the bug below).

**Date fields (`start`/`end`) don't use that pattern at all, for a much more fundamental reason.**
Two rounds of trying to make live-rebuild-and-refocus work for dates (matching the pattern above)
both failed against real user testing, because the underlying assumption doesn't hold for date
inputs specifically: **calling `.focus()` on a native `<input type="date">` always resets its active
internal segment (month/day/year) to the first one — full stop, no exception.** Confirmed
experimentally by relocating the *exact same* DOM node (never destroyed, just detached and
reattached, so nothing about its identity changed) and refocusing it: the active segment still reset
to the first one, exactly as it would for a brand-new node. There is no JS API to refocus a date input
onto a specific segment. So any live-rebuild-and-refocus approach — no matter how carefully the
refocus logic itself is written — can never correctly support typing or arrow-stepping in the month or
year segment: every commit calls `.focus()` again, which unconditionally snaps back to the first
segment, which is exactly what #19 reported ("in the month or year field ... after 1 keypress the
focus jumps back to the day field").

The only real fix: don't call `.focus()` on the field again while it's still being edited at all —
i.e. don't rebuild the table on every `change` for a date field, defer that entirely to the field's
own `'blur'` (the user actually leaving it), the same commit-on-blur idea `name` already uses, just via
a real `blur` listener instead of `change` since a date field's `change` fires mid-edit rather than
only on blur. `change` for `start`/`end` now only ever does `t.start = input.value` (or `t.end = ...`)
+ `markDirty()` — no rebuild, no `.focus()` call, nothing to disturb the field's internal state while
the user is still working in it. A separate capture-phase `'blur'` listener on `#task-tbody` (`blur`
doesn't bubble, same idiom as the repaint workaround below) does the actual `recalcAll()` +
`renderAll()` once the field is genuinely left; no refocus needed there since focus has, by definition,
already moved on by the time `blur` fires. This does mean a date field's own row doesn't show live
Gantt/rollup feedback while it's still focused, the way `duration`/`percentComplete` stepping does —
a deliberate tradeoff, since a `.focus()`-based live-update approach is structurally incapable of
working correctly for date segments regardless of how it's implemented.

That blur listener needed a reentrancy guard (`handlingDateFieldBlur`) for a subtler reason:
`renderTaskTable()`'s `tbody.innerHTML=''` removes every input in the table, including whatever the
user just tabbed *to*, if that's also a start/end field in the same table (e.g. tabbing from Start
straight to End) — the browser fires a real `blur` for that too, which the same capture-phase listener
catches again, reentrantly, from inside the very `renderAll()` call it's already in the middle of.
Without the guard that's a second, wasted rebuild every time, and worse: the reentrant call's own
`renderAll()` then destroys the very field the user just tabbed to, and since this path deliberately
doesn't refocus anything, that Tab could land the user on nothing instead of the field they tabbed to.

Verified with a Playwright test (`tests/playwright-visual-tests.js`, "date field is never rebuilt
mid-edit") that checks the actual code-level guarantee directly — zero rebuilds while focused, exactly
one once blurred, correct final value — rather than simulating real native segment typing. Real native
date-input segment typing turned out to be too flaky to simulate reliably in headless Chromium in this
sandbox across two earlier attempts at reproducing this bug (values jumped to implausible years, an
unexplained extra `blur` fired with no further JS-traceable cause), which is also why the first two
attempted fixes both passed their own headless verification and both turned out to be wrong once
actually tested in a real browser — a reminder that this specific interaction needs real-browser
confirmation, not just headless test-suite green, before considering it actually fixed.

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

### Sticky Task column: row-divider bleed-through (#33)

Reported (with a real screenshot, confirmed on both Chrome and Firefox, at 100% display scaling —
not fractional-DPI-specific): weekend/weekday shading and the vertical segments of dependency arrows
visibly showing through a small gap between each row's Task label, worse while actively scrolling
but present at rest too.

**Mechanism.** `.g-label` (the per-row Task name cell, `position:sticky; left:0;`) stays pinned at
the viewport's left edge while `#gantt-scroll` scrolls horizontally. The weekend/holiday shading
(`.g-bg-cell`) and the dependency-arrow overlay (`#dep-svg`) are **not** sticky — they're normal
absolutely-positioned content that scrolls away with everything else. So as soon as the user scrolls
at all, that non-sticky content slides to wherever the sticky label currently sits, physically
underneath it in the DOM's stacking order. `.g-row`'s divider line was a `border-bottom`, painted at
the row's *outer* edge — and a border at an element's outer edge is exactly where compositing a
sticky layer over independently-scrolling content underneath doesn't always paint fully opaquely,
letting a sliver of whatever's now positioned behind that specific hairline bleed through. Two
earlier attempts at this fix (documented in git history on this branch) both targeted the wrong
mechanism — first the sticky column's own right edge during scroll, then a border crossing between
two independently-positioned hairlines — before the user's screenshot and description made the real
mechanism (this one) unambiguous.

**Fix:** `.g-row`'s divider is now `box-shadow: inset 0 -1px 0 var(--line-strong)` instead of
`border-bottom`. Same visual line, but painted entirely *within* the row's own already-opaque box
rather than at its outer edge — there's no outer boundary left for anything positioned behind it to
show through, regardless of what's scrolled underneath the sticky label at that moment. Applied to
both the interactive Gantt and the static/export renderer's `.g-row` for consistency, even though the
export renderer doesn't have a sticky column (`position:static` there) and so isn't actually
susceptible to this specific mechanism — inset shadows over borders for hairline dividers is simply
the more robust default regardless. The two earlier defenses (`.g-bg-cell`'s redundant `border-right`
removed; `transform:translateZ(0)` + a capping `box-shadow` on the sticky column itself) are kept —
neither is wrong, they just weren't sufficient on their own.

**Two follow-ups after the fix above, from real testing.** First: the inset shadow rendered
noticeably fainter than the border it replaced, worse for tracing a row across — see `.g-row`'s own
comment in the CSS for why (`--line-strong` instead of `--line`). Second, and less obvious: the
divider was invisible in the Task label column specifically, in both light and dark mode, even after
the color fix. Cause: `.g-row` has no explicit `align-items`, defaulting to `stretch`, so `.g-label`
(no height of its own) stretches to the row's full height — and since `.g-label` has its own opaque
background, painted as a *child* (on top of the row's own box-shadow in paint order), it completely
covers that shadow within its own bounds. `.g-label` needed its own divider. Given as a real
`border-bottom` this time, not an inset shadow, and safely so: `.g-label` is the sticky element
itself, entirely within its own already-isolated compositing layer, not spanning a boundary between
sticky and non-sticky content the way `.g-row`'s original border did — the mechanism that made a
border unsafe on `.g-row` doesn't apply to a border confined to `.g-label`'s own box. Same color as
`.g-row`'s shadow so the two read as one continuous line from the label into the chart. Confirmed via
screenshot: continuous divider lines, light and dark mode, at rest and mid-scroll.

### Gantt cursor: only the clickable things

`.g-row` doesn't set `cursor:pointer` — a hand cursor over the entire row, including empty calendar
background with nothing to click, overstated what was actually interactive there. Double-clicking
anywhere in the row still opens the task editor (the `#gantt-scroll` `dblclick` handler resolves the
nearest `.g-row`, unchanged), but the *cursor* only promises that over `.g-label`, `.g-bar`, and
`.g-milestone` specifically, each of which sets its own `cursor:pointer`. `.g-bar` previously had an
explicit (and backwards) `cursor:default` — presumably from an earlier, different reason to
differentiate it, long since irrelevant. `.g-info-btn` stays `cursor:default` deliberately: it's a
hover-tooltip trigger with no click handler of its own, so a pointer cursor there would promise a
click action that doesn't exist.

### Holiday shading vs. the Today marker

`--warn-light` is used *only* for the Gantt's holiday shading (`.g-day-cell.holiday`,
`.g-bg-cell.holiday`) and its legend swatch — nothing else reads it, so it's free to tune
independently of `--warn` itself, which the Today marker (`.today-line`, `.today-flag`) uses
directly and is meant to be the more visually prominent of the two. At its original, more saturated
value this wasn't true in practice: a shaded holiday column can span every row in the chart, and that
much surface area read as more attention-grabbing overall than a single 2px line, even though the
line's own color is more saturated per-pixel. Muted to a subtle near-neutral tint (still a hair
warmer than `--weekend-bg`, so the two stay distinguishable) rather than changing `--warn` itself,
which would also affect the amber RAG status color it's shared with. Confirmed via screenshot with
both markers visible in the same view, light and dark mode.

### Collapsed-row milestone rollup

A real gap in the "children simply aren't in the list" model above: collapsing a parent hides its
*whole* subtree, milestones included, and with them any dependency arrows touching those
milestones — a milestone several tasks deep in a folded branch just vanished from the chart
entirely, arrows and all, with no indication anything was there. Only relevant to
`renderGantt()` (the interactive view); export/print never need it, since they ignore `collapsed`
altogether per the note above.

Fixed by rolling hidden milestones up onto the collapsed row they're hidden behind, scoped
deliberately to **milestones only**, not every hidden task — a milestone gets a marker to anchor an
arrow to, so an arrow pointing at it is legible; a hidden regular task has no marker and no
sensible place a line could point at, so it (and its dependencies) stay invisible while collapsed,
same as before this feature existed. Extending this to regular tasks would need summary bars to
carry information they aren't designed to convey, not just an implementation gap.

- `hiddenMilestoneRow` (built once near the top of `renderGantt()`, before the per-row loop): maps
  every hidden milestone's id to the id of the collapsed ancestor row it should appear on. Built by
  walking `descendantIds(t.id)` for each *visible, collapsed* row `t` — `descendantIds()` recurses
  through every depth, so a milestone two or more collapsed levels deep still resolves to the one
  ancestor row that's actually visible, not an intermediate collapsed one that isn't.
- Rendering: each collapsed row's own per-row loop iteration additionally renders a
  `.g-milestone.collapsed-hidden` marker (same diamond, smaller, with a ring — see the CSS gotcha
  comment there) for each of its rolled-up milestones, positioned at *that milestone's own date*
  (`xForISO(d.start)`) but the *collapsed row's* Y. Each gets its own hover tooltip
  (`buildGanttTooltipHtml(d)` for the milestone itself, not the row it's sitting on).
- Arrows: `arrowEndpoint(id, isPredEnd)` resolves either end of a dependency edge to `{x, y}` — `y`
  from `rowY[id]` if visible, else `rowY[hiddenMilestoneRow[id]]` if it's a rolled-up milestone,
  else `null` (meaning: don't draw, same as the old behavior for anything not in `rowY`). The arrow
  loop itself iterates **every** predecessor link in `state.tasks`, not just visible rows' own
  links like before — needed so a hidden milestone's own predecessor links, and links from other
  tasks depending *on* a hidden milestone, both get considered, not only the visible-task-owns-the-
  link direction the original loop covered. This is a strict superset of the old behavior (any pair
  that resolves via `rowY` alone renders identically to before); the `null` checks are what keep it
  from drawing anything for a genuinely hidden non-milestone task.

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
`openTaskEditModal()`). They share the same `.pop-row` / `.dep-name` / `.dep-date` markup and CSS,
and, since the lag feature (see "Dependency lag" above), the actual row-building functions too
(`depRowHtml()` and friends) — the row markup got fiddly enough (checkbox, name, conditional lag
control with its own resting/editing states) that hand-duplicating it in two places became a real
drift risk, not just a style-consistency nice-to-have. What's still *not* shared is the event
wiring that decides when a change commits (immediately for the popover, only on Save for the modal)
— see "Dependency pickers: the lag UI" for why that split is intentional, not an oversight.

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

`.dep-name` still ellipsis-truncates against the popover's narrow width, so a long or
deeply-nested name can be impossible to read in full from the row alone. `bindDepNameTooltips()`
binds a hover tooltip (the shared `bindHoverTooltip()` engine) to every `.dep-name[data-task-id]`
in a container, showing `taskHierarchyPath(id)` — the full name plus every ancestor's, root-first
(`Phase 2 › Backend › API Endpoints`). Called once after the rows are actually in the DOM (both
`bindHoverTooltip()` and `data-task-id` lookups need real elements, not the markup string
`depRowHtml()` returns), which in the popover's case means every reopen, same as the filter/lag
wiring above; in the modal it's a one-time call at open time, since checkbox toggles there patch
existing row DOM in place rather than rebuilding it.

**Gotcha: a popover needs its own close affordance, not just outside-click.** Both dependency
popovers (Task List Deps chip, Dashboard resource filter) used to be dismissible only by clicking
elsewhere — no close button, no Escape, unlike every modal in the app (which all support Escape via
`teOnKeydown` or equivalent). Fixed with a shared `closePopoverFully()` plus one global `keydown`
listener for Escape (added once, not per-open — it's a no-op whenever `#popover-root` is empty, so
it can't fire while a modal's own Escape handling is active instead) and a `.popover-close` (×)
button in each popover's header. The two popovers' own outside-click handlers
(`outsidePopoverClick`/`outsideResourcePopoverClick`) now route through the same
`closePopoverFully()` too, via a single `activePopoverOutsideHandler` reference, rather than each
managing its own listener removal — only one popover is ever open at a time, so there's no need for
the close path to know which one it's closing.

**Gotcha: popover horizontal clamping must match the real CSS max-width, not an approximation.**
`openDepsPopover()` and `openResourceFilterPopover()` (Dashboard) both position a floating
`.popover` via `popoverLeftClamp(rect)`, which clamps the left edge so the box can never render
past the right edge of the viewport. This used to be a bare `Math.min(rect.left, window.innerWidth
- 260)` inlined at each call site — 260 was a guess, not the actual `.popover` CSS rule's
`max-width:300px`, and deps rows commonly push the popover to that real 300px ceiling. The result:
the popover's right edge could sit up to 40px past the viewport, forcing a horizontal scrollbar,
worst when the anchor button (e.g. the Deps chip, near the right end of the Task List row) was
already close to the window edge. Fixed by centralizing the clamp in one function that references
`POPOVER_MAX_WIDTH` (kept in sync with the CSS by comment, since there's no way to read a CSS rule's
value back into JS without adding a runtime measurement step) instead of a second, silently-drifting
guess. If you widen `.popover`'s `max-width` in CSS, update `POPOVER_MAX_WIDTH` in the same change.

**Gotcha: vertical positioning needs the same treatment as horizontal, and used to have none at all
(#48).** All four popovers (`openDepsPopover()`, `openTagsPopover()`, `openResourceFilterPopover()`,
`openTagFilterPopover()`) set `top` to a bare `anchor.bottom + 4`, unconditionally opening flush below
the button regardless of how close that button was to the bottom of the viewport. Because `.popover`
is `position:absolute` in document coordinates rather than viewport-fixed, a popover tall enough (a
task with a lot of tags or dependencies) near the bottom of a long Task List would render mostly or
entirely below the visible viewport — reachable only by scrolling the *page* itself, which meant
moving the mouse off the popover first, since opening it didn't scroll any of it into view.

Fixed with a shared `positionPopover(popEl, anchorRect)`, the vertical counterpart to
`popoverLeftClamp()`: prefers opening below (unchanged for the common case), flips to opening above
the anchor when there's more room there, and as a last resort clamps to the viewport for a popover
that doesn't fully fit on either side. All four call sites now call it after their `.popover` element
is actually in the DOM, not from within the same template-string that creates it — unlike the
horizontal clamp, the vertical decision needs the popover's own real rendered height (which depends on
its content: row count, whether a filter box or footer buttons are present), not a fixed constant.
**If you touch `openTagsPopover()` again:** it's the one call site where this ordering actually
matters, not just as a style preference — `positionPopover()` has to run *after*
`renderTagPickerInto()` has filled `.tag-picker-body`, since at the point the popover's own template
string is first inserted, that container is still empty (just the header), so measuring at that point
would produce a too-small height and effectively skip the flip logic.

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

### Keyboard reordering (Ctrl+Shift+Up/Down)

A separate `keydown` listener on `#task-tbody` (not merged into the date-copy/paste one above,
which bails out immediately for anything that isn't a date input) reorders the focused row among
its siblings via `moveTask()`, from anywhere within the row — the name field, a date field, one of
the row's own buttons. Added because the row's own ↑/↓ buttons move *with* the row on every click,
so a rapid sequence of reorders means physically chasing them with the cursor; the keyboard path
doesn't have that problem since it doesn't depend on the mouse being anywhere in particular.
`moveTask()` already no-ops silently at either end of the sibling list (no `swapWith`), so the
keyboard handler doesn't duplicate that bounds-checking. After the move, it refocuses the *same*
field (by `data-field`) or button (by `data-act`) on the row's new DOM node — `moveTask()` calls
`renderAll()`, which rebuilds the table and destroys the original node, so without this a keyboard-
only reordering session would lose focus after the first move.

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

`classifyTask(t)` buckets a task into `overdue` / `current` / `upcoming` / `upcoming-milestone` /
`completed` / `null` (parents return `null`; only leaf tasks are actionable work items). Upcoming
tasks and upcoming milestones (`isMilestone(t)`, i.e. `duration === 0`) get separate buckets and
separate cards ("Upcoming Tasks" / "Upcoming Milestones") so a project with several milestones
doesn't crowd out the regular tasks in one shared list; Overdue and In Progress deliberately stay
mixed, since that split was only asked for on the Upcoming bucket. `taskItemHtml(t)` is the single
shared card-renderer used everywhere a task appears on the dashboard (all the status buckets, the
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
  valid state (circular deps, resource casing, stale milestone resources) before rendering. It's the
  single entry point all three ways of opening a file funnel through: the file picker
  (`showOpenFilePicker`), the fallback `<input type="file">`, and drag-and-drop.
- **Drag-and-drop** a `.json` file onto the window is a fourth on-ramp to the same `loadFromText()`
  path, not a separate load mechanism. `window`-level `dragenter`/`dragover`/`dragleave`/`drop`
  listeners `preventDefault()` on every stage (otherwise the browser navigates to the dropped file
  instead of firing `drop`), guarded by `isFileDrag()` so a drag that isn't carrying files doesn't
  trigger anything. `dragDepth` is a counter, not a boolean, because `dragenter`/`dragleave` fire
  once per child element the pointer crosses while dragging over the page, not once for the whole
  window: a boolean flickers the overlay on and off as the drag crosses element boundaries; the
  counter only hides it once it's genuinely left. The full-screen `#drop-overlay` has
  `pointer-events:none` so it never itself becomes a drag target and doesn't interfere with the
  window-level listeners underneath it.

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
7. Update `FILE_FORMAT.md` and the inline schema comment near `const state`, both of which list every
   Task field by hand — neither updates itself, and both had already drifted out of sync with the
   real fields (missing `status`/`collapsed`) before `FILE_FORMAT.md` existed specifically to fix that.

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

**Gotcha: don't cap `.export-section`'s width.** It used to have `max-width:1400px`, which meant
the exported page stopped growing past that regardless of how wide the browser window actually was
— on anything wider (an ultrawide or a maximized window on a large monitor), that left dead space
on the right instead of the content filling it, a real reported complaint. Removed; the section now
just fills `body`'s own width (which itself is unconstrained, only padded). This is safe specifically
because the Gantt content already has its own inner `overflow-x:auto` wrapper
(`buildStaticGanttHtml()`) for genuinely wide date ranges — the outer section never needed to be the
thing providing width-limiting/scroll behavior, it was just an unrelated leftover constraint.

**Gotcha: don't cap `.export-section`'s (or the Gantt wrapper's own) height either, for the same
reason (#53).** `buildStaticGanttHtml()`'s wrapper used to also carry a fixed `max-height:520px` with
`overflow:auto`, unrelated to the chart's actual rendered height — any schedule with enough rows to
exceed it got an internal vertical scrollbar instead of the section (and the page around it) simply
growing to fit, the vertical counterpart to the width gotcha just above. This is a read-only,
standalone snapshot, not the interactive on-screen view, so there's no interactive reason to
height-constrain it. Fixed by dropping `max-height`/vertical `overflow` from that wrapper entirely —
`overflow-x:auto` stays, since a very wide date range is still a legitimate reason to scroll
horizontally rather than shrink everything illegibly (same reasoning `computePrintGanttParams()`
documents for print). If you touch this again: only the vertical cap was ever the problem here: don't
reintroduce a fixed height constant of any kind on this wrapper, but the horizontal one is intentional
and should stay.

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

# Backlog

Working list of known bugs, planned improvements, and process/infra work for
`timeline-schedule-tool.html`. Update this file as items are picked up,
completed, or reprioritized. It's the shared source of truth for what's
next, not a historical record (that's what `CHANGELOG.md` and git history
are for).

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done (move to
Changelog and remove from here once released).

## Bugs

1. [ ] Task edit modal: the RAG status color dot is not vertically
   aligned with the status text next to it (`.status-select-wrap
   .status-dot` is `position:absolute; left:11px;` with no `top`/
   vertical-centering rule, so it just sits at its default static
   position rather than actually being centered against the `<select>`'s
   text — worth checking as the likely cause when this gets picked up).
2. [x] Task List UI can get noticeably laggy when typing a new task's
   name. Root cause confirmed: every keystroke in the name field called
   `renderGantt()` and `renderDashboard()` in full (`#task-tbody`'s
   `input` handler) — both rebuild their entire HTML/SVG from scratch
   (~400 lines each), on every character. Every other field (resources,
   dates, duration) already deferred this to blur/`change`; name was
   the one exception. Fixed by deferring the Gantt/Dashboard re-render
   to `change` (blur), same pattern as everything else — the data model
   and the Task List's own dirty-dot still update live on every
   keystroke, only the two expensive full-rebuilds are deferred. Merged
   to `main`, not yet released; see `CHANGELOG.md`'s `[Unreleased]`
   section.
3. [x] No warning before an action overwrites/loses existing task data.
   Root cause confirmed and worse than expected: any task that gains
   its *first* child (via the row's ➕ "Add subtask" button, or via
   indenting a task under a previously-childless sibling) instantly
   becomes a parent, and `recalcAll()`'s rollup pass **overwrites its
   `start`/`end`/`duration`/`percentComplete`/`resources` in place**,
   computed from children. If the task already had its own values set,
   they're genuinely gone, not just hidden — there's no undo. Fixed
   with a confirmation dialog (`confirmParentOverwrite()`) before both
   destructive cases, naming what will be lost; no-ops silently for a
   task that's still on defaults (nothing at stake). Built together
   with Improvement 4. Merged to `main`, not yet released; see
   `CHANGELOG.md`'s `[Unreleased]` section.

The previous batches (Gantt "Today" scroll, RAG red/amber contrast, live
status dot, arrow-key focus loss, stale selection-highlight repaint,
deps/resource popover overflow, stale About-panel update check) shipped
in `v1.0.1`, `v1.1.0`, and `v1.1.1`; see `CHANGELOG.md` for details.

## Improvements

Copy/paste discoverability, drag-and-drop open, the Dashboard Upcoming
split, the About update badge, and dependency lag (plus its follow-up
fixes) shipped in `v1.1.0`; see `CHANGELOG.md` for details.

**Build order agreed for the current batch** (Bugs 2-3 above plus the
Improvements below, triaged together): Bug 2 (typing lag) → Bug 3 +
Improvement 4 (warning dialog + two buttons) → quick wins (6, 9, 12) →
mediums (5, 7, 10, 13) → Improvement 11 (tags) last, being the largest.
Cheapest/safest first, biggest last.

1. [ ] **Needs a design discussion before any code.** Support durations
   smaller than 1 working day (e.g. half-days). Looked into the scope: the
   whole scheduling model is date-only, not date-time (`parseISO` discards
   any time component), and every function that matters treats a calendar
   day as the atomic unit (`addWorkingDays()`, `countWorkingDays()`,
   dependency chaining in `earliestStartFromPredecessors()`, and the Gantt's
   pixels-per-day bar geometry). That splits "half-day durations" into two
   materially different features:
   - **Cosmetic/reporting only**: a task can be *labeled* "0.5d" for display
     and rollup math, but still occupies a whole calendar-day slot for
     scheduling purposes (two half-day tasks on the same day still can't be
     sequenced same-day). Small, contained change: loosen `sanitizeDuration`
     to allow fractional values above 0, stop relying on `duration === 0`
     alone for the milestone check (it currently collides with any
     fractional value between 0 and 1), adjust bar-width/rollup math to use
     the fraction.
   - **Real same-day sequencing**: a task can finish mid-day and a dependent
     task starts later that same working day. Needs an actual time-of-day
     model, not just a fractional day count: dates become datetimes, a
     working-day window needs defining (9-5? configurable?), and
     `addWorkingDays`/`countWorkingDays`/dependency math/Gantt pixel math all
     move from day-granularity to hour-granularity. This is a genuine
     rearchitecture, not a bug fix.

   Parked pending a decision on which of these is actually wanted (most
   likely same-day sequencing is the real ask, but that's the expensive one
   to build) before any implementation starts.
2. [ ] **Needs a design discussion before any code.** The Task List's
   `<table>` doesn't set `table-layout:fixed`, so every column's width is
   computed from content across *every* row rather than being pinned per
   column. The Deps chip `min-width:70px` fix above works but is a
   one-off patch on the one instance that got noticed, not a fix to the
   underlying cause — worth a proper pass over the whole table rather
   than whack-a-mole-ing each symptom as it's found. Two known examples,
   for whoever picks this up:
   - The Deps chip reflow itself (see above): any row's cell content
     getting wider than every other row's shifts the column, and
     everything after it, sideways.
   - The % Done column doesn't render the same shape of content for
     every row: milestone rows show a checkbox + "Done" label
     (`.milestone-done-stack`), regular task rows show a number input +
     progress bar (`.pct-cell`). Different natural widths for the two
     shapes mean the numbers/checkboxes don't line up horizontally with
     each other across rows of different types, which reads as sloppy
     even though each individual row is laid out correctly on its own.

   Likely direction: explicit per-column widths (a `<colgroup>` and
   `table-layout:fixed`, or min/max-width rules disciplined enough to
   have the same effect) so column geometry is a property of the table,
   not an emergent side-effect of whatever happens to be in each cell —
   but that needs auditing every column (not just these two examples)
   for what its content actually requires, and deciding how overflow
   should behave for each one (truncate? wrap? scroll?) rather than
   just patching the two instances above. A later report ("the grid is
   still wonky — need fixed row heights and column widths, with enough
   space and correct alignment, everywhere") is the same underlying
   ask; folded in here rather than tracked as a separate item.
3. [ ] **Needs a design discussion before any code — exploratory.** Explore
   identifying the **critical path** through a schedule, both as data and
   as an optional/toggleable visual element. Not scoped yet; open
   questions to work through before building anything:
   - **What "critical path" means here, concretely.** Classically: the
     longest chain of dependent tasks (by duration) ending at the
     project's overall finish, where any slip on a task in that chain
     slips the whole project by the same amount; every other task has
     some slack ("float"). Computing it needs both a forward pass
     (earliest start/finish, which `recalcAll()` already effectively
     does) and a backward pass (latest start/finish working back from
     the project end) to get each task's float — the backward pass
     doesn't exist in the scheduling engine today.
   - **What counts as "the project end"?** There's no single explicit
     "project end" concept in the data model right now — the latest
     `end` across all leaf tasks, implicitly. Does that need to become
     an explicit thing (e.g. pick a milestone as the target), or is
     "latest end across everything" good enough?
   - **Lag interacts with this.** A dependency's `lag` (see the
     dependency-lag work) changes how long a chain effectively is —
     the classic algorithm needs adjusting to account for it, not just
     for raw task durations.
   - **Parent/summary tasks.** Does the critical path highlight leaf
     tasks only, or also mark a parent as "contains a critical-path
     task"? Parents are rollups, not real participants in the
     dependency graph the same way leaves are.
   - **Where it's shown, and how optional.** Gantt bar highlighting
     (a distinct color/border, similar to how overdue tasks already get
     a red inset shadow) seems like the natural home, toggleable so it
     doesn't clutter for people who don't care about it. Whether it also
     belongs on the Dashboard (a count? a list? its own card?) is
     genuinely open — flagged as "not sure if it could be represented
     there" when this was raised, worth thinking through rather than
     assuming yes.
4. [x] The row's ➕ button should be able to add a **sibling** (same
   level/depth), not only a sub-task. The button was labeled "Add
   subtask" and did exactly that, so changing its default behavior
   would have made the label lie. Split into **two buttons** instead —
   ➕ (`add-sibling`, same depth as the clicked row, bigger icon since
   it's the everyday action) and `+` (`add-sub`, child, current
   behavior, smaller icon since it's now the less-common, guarded
   action, now goes through Bug 3's warning) — so creating a sub-task
   is a deliberate choice rather than the default outcome of the one
   button everyone reaches for. Built together with Bug 3's warning
   dialog. Merged to `main`, not yet released; see `CHANGELOG.md`'s
   `[Unreleased]` section.
5. [x] A way to **insert** a new task mid-list, at a specific position,
   rather than only ever appending at the bottom and having to move it
   up into place afterward. Resolved incidentally by Improvement 4: the
   row's sibling-add button now inserts right after the clicked row,
   not at the end of the list, so inserting mid-list is just "click
   the button on the row above where you want it." No separate work
   needed; confirmed with the user rather than assumed.
6. [x] Dependency picker (popover and modal): long task names get
   truncated and there's no way to see the full name without already
   knowing it. Fixed by having the hover tooltip show the full name
   and full hierarchy path (e.g. "Phase 2 › Backend › API Endpoints")
   rather than widening the picker, which would've reopened the
   popover-width/scrollbar issues fixed earlier. Merged to `main`, not
   yet released; see `CHANGELOG.md`'s `[Unreleased]` section.
7. [x] Reordering tasks with the up/down move buttons means chasing the
   button with the cursor as the row moves (the button moves with its
   row, so a rapid sequence of clicks needs the cursor to keep
   relocating). Fixed with Ctrl/Cmd+Shift+↑/↓, working from anywhere in
   the focused row (not just a specific field), refocusing the same
   field/button on the row's new position after each move so a
   keyboard-only reordering session doesn't lose focus. Improvement 8
   stays parked. In progress on
   `mediums/reorder-insert-collapse-reverse-dep`, not yet merged; see
   `CHANGELOG.md`'s `[Unreleased]` section.
8. [ ] Bulk-relocate a task and its whole subtask group at once (copy/
   paste, cut/paste, or some other mechanism), as an alternative to
   one-at-a-time up/down moves for restructuring a chunk of the
   schedule. **Triaged:** parked in favor of Improvement 7 for now —
   both solve "moving tasks around is tedious" but neither really
   substitutes for the other (single-row nudge vs. whole-subtree
   relocation); revisit once 7 is built and it's clearer whether the
   rarer bulk-relocation case still needs its own mechanism.
9. [x] No way to cancel/close the dependency popover except by moving
   focus to another field (e.g. clicking elsewhere). Fixed with both: a
   close (×) button in the popover header, and Escape key support
   (matching how modals already close via `teOnKeydown`). Applied to
   the Dashboard's resource-filter popover too, since it's the same
   underlying component. Merged to `main`, not yet released; see
   `CHANGELOG.md`'s `[Unreleased]` section.
10. [x] Gantt: collapsing a parent row hides its children entirely,
    including any milestones among them — so a milestone belonging to a
    collapsed subtree, and the dependency arrows connecting it to other
    tasks, both disappear. Fixed by rolling hidden milestones up onto
    the collapsed row (a small ringed marker at the milestone's own
    date), with dependency arrows resolved to that row too. Scoped to
    milestones specifically, not every hidden task — a milestone has a
    marker to anchor an arrow to; a hidden regular task has no sensible
    place a line could point at. Works through nested collapsed levels
    too. In progress on
    `mediums/reorder-insert-collapse-reverse-dep`, not yet merged; see
    `CHANGELOG.md`'s `[Unreleased]` section.
11. [ ] Tags on tasks (e.g. `PO`, `DOC`) for filtering/grouping in
    reporting contexts — the example given was tagging purchase-order
    items or deliverable documents so they can be filtered to on the
    Dashboard. Would need: a new field on the task schema, UI to
    add/edit tags (Task List cell? edit modal?), and a filter mechanism
    on the Dashboard alongside (or combined with) the existing resource
    filter.
12. [x] **Low priority.** The static HTML export doesn't scale to fill
    the window width cleanly — looks mostly, but not quite, fixed-width.
    Root cause: `.export-section` had a stray `max-width:1400px`,
    unrelated leftover that capped the whole page regardless of window
    size, while the Gantt content already has its own inner
    `overflow:auto` wrapper for wide date ranges — the outer cap wasn't
    doing anything useful. Removed. Merged to `main`, not yet released;
    see `CHANGELOG.md`'s `[Unreleased]` section.
13. [x] Visual indicator for the *reverse* dependency direction: a task
    that other tasks depend on currently shows nothing to flag that;
    only the dependent task's own Deps chip shows anything, and only
    from that task's side. Fixed with a small "🔗N" badge next to the
    task's name (hover for the list of what it blocks), plus a
    "Blocks" section in the Gantt hover tooltip. Read-only — you still
    add a dependency from the dependent task's own Deps picker, same as
    before. In progress on
    `mediums/reorder-insert-collapse-reverse-dep`, not yet merged; see
    `CHANGELOG.md`'s `[Unreleased]` section.

## Broader / process (tackling first)

Being done first, before the bug/feature work above, because there are
already a couple of other people using the tool and we want subsequent
fixes to flow through the new release process rather than around it.

1. [x] `CHANGELOG.md`, maintained per release (Keep a Changelog format).
2. [x] GitHub Actions release workflow: triggered by pushing a `vX.Y.Z` tag,
   builds a release with the bare HTML file attached (GitHub's automatic
   "Source code" zip/tar.gz already covers the repo snapshot, so the
   workflow doesn't build a redundant one) and notes pulled from the
   matching `CHANGELOG.md` section. (`.github/workflows/release.yml`)
3. [x] Branch strategy: feature branches → PR → `main`, documented in
   `CONTRIBUTING.md`. Releases are cut by tagging `main`.
4. [x] GitHub branch protection on `main`: PRs required (admin bypass
   allowed for standalone docs/backlog housekeeping only; see
   `CONTRIBUTING.md`'s "Direct pushes to main"), force-pushes and branch
   deletion blocked, no required review count.
5. [x] GitHub link + About panel in the app header, showing current version
   and license, with a best-effort "newer version available" check against
   the GitHub Releases API.
6. [x] Versioning: semantic versioning (`vMAJOR.MINOR.PATCH`); `APP_VERSION`
   in the HTML starts at `1.0.0` for the current stable state.
7. [x] Open the PR for branch `infra/release-process` into `main`, merge,
   then tag `v1.0.0` and push the tag to trigger the first real release.
   Done: PRs #1–#3 merged in order (release process, verification fixture,
   `AGENTS.md`), `v1.0.0` tagged and released:
   https://github.com/sam-ward/timeline/releases/tag/v1.0.0
8. [ ] **Needs a design discussion before any code.** Whether it's worth
   restructuring `timeline-schedule-tool.html` for better *development*
   ergonomics as it keeps growing (currently ~2,700 lines, one file, one
   `<script>` block): e.g. splitting CSS/JS/markup into separate source
   files during authoring, assembled into the single shipped file by a
   lightweight build/concat step, while keeping the **shipped output**
   exactly what it is today: one dependency-free file, still runnable by
   double-clicking it, no runtime framework or bundler added to the app
   itself. This is explicitly about authoring ergonomics only, not the
   "why a single file?" constraint in `ARCHITECTURE.md`/`AGENTS.md`, which
   stays either way. Needs to weigh editor/diff/merge-conflict ergonomics
   of smaller files against the current zero-tooling "the file you edit is
   the file that runs" simplicity, and whatever CI/build-step complexity a
   concat step would add (including keeping it in sync with the release
   workflow). Park until the smaller bugs/improvements above are cleared;
   revisit then.

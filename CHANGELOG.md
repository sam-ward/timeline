# Changelog

All notable changes to Timeline are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Export HTML: the Gantt Chart section was wrapped in a fixed-height, scrollable box — any schedule
  with enough rows to exceed it showed an internal vertical scrollbar instead of the chart (and the
  page around it) simply expanding to fit, the way the Task List and Status Summary sections already
  do in the same export. It now always expands to its full height; it still scrolls horizontally for
  a genuinely wide date range. (#53)
- Task edit modal: adding a genuinely new tag (not already used on any other task) in the Tags
  field looked like it silently did nothing — the checkbox list didn't update, with no confirmation
  the tag had been added. It only actually appeared (checked) after saving and reopening the modal.
  The picker's row list was built from the global tag vocabulary alone, which doesn't include a tag
  that's only been added to this modal's own uncommitted, not-yet-saved copy of the task; it now
  also includes whatever's on that in-progress copy, so a newly-added tag shows up immediately. (#46)
- Task edit modal: the "New tag..." input and Add button used to scroll away along with the tag
  checkbox list instead of staying in view. They're now a `+ Add tag…` toggle pinned below the list
  (outside its scroll area), which reveals the input/button in place when clicked and collapses back
  after a successful add or when it loses focus — also saves vertical space in the modal. Applies to
  the Task List's own Tags popover too, since it shares the same widget. The checkbox list itself now
  also caps its own height earlier (fits ~4 rows before it scrolls internally) so a task with a lot of
  tags no longer grows the whole modal past its own max-height and forces the entire modal to scroll,
  header/footer included. (#47)
- The Deps and Tags popovers (Task List), and the resource/tag filter popovers (Dashboard), always
  opened flush below the button that triggered them, regardless of how close that button was to the
  bottom of the window. A tall popover (a task with a lot of dependencies or tags) near the bottom of
  a long list could render mostly or entirely off-screen, visible only by scrolling the page itself —
  which meant moving the mouse off the popover first, since opening it never scrolled any of it into
  view. Popovers now flip to open above their button instead, whenever there isn't enough room below
  but there is above. (#48)

## [1.3.2] - 2026-08-23

### Fixed

- The #40 fix stopped `moveTask()` from scrambling task array order
  going forward, but didn't repair a schedule already saved with
  scrambled order from before the fix — reloading it still showed the
  wrong order in the "Depends on" pickers. `recalcAll()` now rebuilds
  task order into proper tree order every time (alongside its existing
  resource/tag-casing cleanup), so any array-order drift self-heals
  automatically regardless of source. (#43)

## [1.3.1] - 2026-08-23

### Fixed

- Task List: using the ▲/▼ reorder buttons (or Ctrl+Shift+Up/Down) to
  move a parent task past a sibling only swapped the two tasks' own
  rows in the underlying data, leaving the moved-past parent's
  children behind at their old position. The Task List and Gantt
  looked fine (both render by walking the parent/child tree, not raw
  array order), but anything reading that raw order directly — like
  the "Depends on" pickers' task list, and the order tasks are saved
  in — went out of sync with what the tree actually showed. Reordering
  now moves a task's whole subtree together. (#40)

## [1.3.0] - 2026-08-22

### Added

- Task List and Gantt Chart: "Collapse All" / "Expand All" buttons in
  each view's toolbar, alongside the existing per-row toggle. Both
  views share the same collapsed state, so either view's buttons
  affect both. (#18)
- `FILE_FORMAT.md`: a full field-by-field reference for the saved
  schedule JSON format, for anyone building a tool or AI agent that
  reads or writes schedule files directly. (#20)
- Tags: freeform labels (e.g. `PO`, `DOC`) for filtering/reporting.
  Add them from a new "Tags" chip in the Task List (a checkbox popover
  listing every tag in use, plus a field to add a new one — the same
  style as the Deps picker, not a free-text field, so a small
  vocabulary stays consistent instead of forking into near-duplicates)
  or from the task edit modal. Filter the Dashboard by tag the same
  way you already can by resource, combining with the resource filter
  to narrow further. Unlike resources, tags don't roll up to parent
  tasks and work the same on every task type, including parents and
  milestones. A tagged task also shows a small 🏷 marker on its Gantt
  row, the full tag list in the Gantt hover tooltip, and its tags
  alongside its resources on Dashboard cards. With two independent
  filters now, a "Clear filters" button appears next to them whenever
  either is active, resetting both at once. (#26)

### Fixed

- Task List: editing a Start/End date could snap back to the day
  segment after a single keypress or arrow-key step in the month or
  year segment. Root cause: refocusing a native date input always
  resets its active segment to the first one, no matter what — so any
  approach that rebuilds the table and refocuses the field on every
  edit was guaranteed to keep interrupting month/year edits, no matter
  how that refocus itself was implemented. Date fields no longer
  rebuild the table while still focused at all; the schedule now
  recalculates once the field is actually left instead. (#19)
- Task edit modal: the RAG status color dot wasn't vertically centered
  against the status text next to it — off by about 5.5px, since it
  was absolutely positioned with no vertical-centering rule. (#21)
- Gantt: weekend/weekday shading and dependency-arrow lines could
  show through a small gap between each row's Task label — worse
  while scrolling, present at rest too, on both Chrome and Firefox.
  Root cause, confirmed from a real screenshot and description: the
  Task label column is sticky and stays put while scrolling, but the
  shading and arrows underneath it are not sticky and scroll normally
  — so they end up positioned behind the label, and the row divider
  line (previously a `border-bottom`, painted at the row's outer
  edge) didn't always paint fully opaquely over whatever was now
  behind it there. Redrawn as an inset shadow instead, painted fully
  within each row's own opaque box, closing the gap regardless of
  what's scrolled underneath. That inset line initially rendered
  noticeably fainter than the border it replaced, and didn't show up
  at all in the Task label column specifically (the label's own
  background covers it there) — switched to a stronger color for the
  row's line and gave the label column its own matching divider, so
  it's easy to trace a row across from the label into the chart. (#33)
- Gantt: the mouse cursor showed a hand (implying something clickable)
  over an entire row, including empty calendar background with
  nothing to click. Now only shows a pointer over the things that
  actually are clickable: a row's Task label, and each bar/milestone.
- Gantt: holiday shading was more visually prominent than the Today
  marker, across a whole shaded day-column spanning every row — more
  attention-grabbing than the thing meant to be the strongest visual
  anchor. Muted to a subtle neutral tint; Today is unchanged.

## [1.2.0] - 2026-08-18

### Added

- Task List: the row's "add subtask" (➕) button is now two buttons —
  ➕ adds a task at the same level as the row it's clicked from, `+`
  adds a sub-task. Creating a sub-task is now a deliberate choice
  instead of the default outcome of the one button everyone reaches
  for to add the next task.
- Dependency picker (Task List popover and task edit modal): hovering
  a truncated task name now shows the full name and its complete
  hierarchy path (e.g. "Phase 2 › Backend › API Endpoints").
- Both dependency popovers can now be closed with a × button or the
  Escape key, not just by clicking elsewhere.
- Task List: reorder a task with Ctrl/Cmd+Shift+↑/↓ from anywhere in
  its row, instead of only via the row's own ↑/↓ buttons (which move
  with the row, so repeated clicks mean chasing them with the cursor).
- Task List: a task that other tasks depend on now shows a small
  "🔗N" badge next to its name (hover for the list of what it
  blocks) — previously only visible from the dependent task's own
  side. Also added to the Gantt hover tooltip.
- Gantt chart: collapsing a group no longer hides its milestones
  entirely. Each one now rolls up onto the collapsed row as a small
  ringed marker at its own date, with its dependency arrows still
  drawn, instead of just disappearing along with the rest of the
  folded-away subtree.

### Fixed

- Task List: typing a task's name could get noticeably laggy, worse
  the larger the schedule. Every keystroke was fully re-rendering the
  Gantt chart and Dashboard; both now update once typing pauses (on
  blur), the same as every other field already worked.
- A task with its own duration, progress, or assigned resources set
  would silently lose them the moment it gained its first sub-task or
  was indented under a previously-childless sibling — both turn it
  into a parent, whose fields get overwritten by a rollup from its
  children with no undo. Both actions now confirm first, naming what
  would be lost, when there's actually something at stake.
- Static HTML export no longer stops growing at 1400px regardless of
  how wide the browser window is — sections now fill the available
  width on wider screens instead of leaving dead space on the right.

## [1.1.1] - 2026-08-13

### Fixed

- About panel: reopening it could report "you have the latest version"
  indefinitely in a long-lived tab, even after a newer version had since
  been published. The update check was reusing the result of the
  one-off background check from page load instead of checking again;
  opening the panel now always checks fresh.

## [1.1.0] - 2026-08-13

### Added

- Task List date fields now show a tooltip on hover explaining the
  Ctrl/Cmd+C / Ctrl/Cmd+V copy-paste shortcut, which previously had no
  visible indication it existed. Only shown on editable (unlocked) date
  fields, since locked ones are `disabled` and can't be focused to use
  the shortcut at all.
- Drag a `.json` schedule file onto the window to open it, alongside the
  existing Open button/file picker.
- Dashboard: upcoming milestones now have their own "Upcoming Milestones"
  card, separate from "Upcoming Tasks", instead of being listed together.
- The About button (ℹ️) now checks for a newer version in the background
  on load and shows a small orange dot if one's available, instead of
  only surfacing that after opening the About panel.
- Dependencies can now have a **lag** (or negative lag / lead time): a
  number of working days a dependent task waits after its predecessor
  finishes before it's eligible to start, instead of always starting the
  very next working day. Set per dependency from the Task List's Deps
  popover or the task edit modal's "Depends on" list — check a
  dependency, then click its date (or, once a lag is set, the small
  badge next to it) to reveal a +/- stepper in place. A lag of 0
  (the default, and what every existing dependency has) behaves exactly
  as before. The Task List's Deps chip now shows a small "±" flag
  whenever a lag is affecting a task's scheduled start, since it was
  otherwise only visible by hovering the chip or opening the picker.

### Fixed

- The Task List's dependency picker (and the Dashboard's resource filter)
  could render partially off the right edge of the window, forcing a
  horizontal scrollbar. The clamp keeping these popovers on-screen used a
  guessed width instead of the popover's real CSS max-width.
- Task List: % Done column is a little narrower, giving the Deps popover
  more room to open without needing to clamp at all. (Start/End were
  narrowed too in an earlier pass, but that made the native date
  picker's calendar icon overlap the last digit of the year in some
  browsers — reverted to their original width, since the popover clamp
  fix above doesn't actually depend on the columns being narrower.)
- Dependency picker (Task List popover and task edit modal): once there
  were enough candidates to scroll, the scrollbar could overlap the last
  couple of digits of the right-aligned date text. Both lists now reserve
  padding for it.

## [1.0.1] - 2026-08-13

### Fixed

- Gantt "Today" button no longer lands behind the sticky task-label column.
  It now accounts for the column's actual width instead of a hardcoded
  offset.
- RAG status red is now clearly distinct from amber, which were previously
  easy to confuse at a glance (both muted brick/rust tones).
- Task edit modal: the Status dropdown's dot now recolors immediately when
  changed, instead of only after saving and reopening.
- Arrow-key stepping (or clicking the native spinner) on a date, duration,
  or % complete field in the Task List no longer loses focus after a
  single keypress.
- Fixed a stale text-selection highlight that could linger on a date/text
  field after clicking away from it, until another field was focused. A
  browser rendering quirk (confirmed on Chrome and Firefox, Windows and
  Linux), not an app logic bug, but fixed defensively regardless.

## [1.0.0] - 2026-08-13

Baseline release: the app as it stood before the release process existed,
covering everything built up to this point, plus the release process
infrastructure itself (this changelog, `CONTRIBUTING.md`, `backlog.md`,
the GitHub Actions release workflow, and the app's own About panel /
version check), all of which shipped as part of this same tag.

### Added

- Core app: Task List, Gantt Chart, and Dashboard views.
- Working-day-aware scheduling engine with dependencies and parent/child
  rollups (`recalcAll()`).
- Milestones (`duration === 0` convention).
- Holidays / non-working-day management.
- Save/Open via the File System Access API where supported, with a
  download-based fallback elsewhere.
- Static HTML export and print support (Task List, Gantt, Dashboard).
- Task edit modal with unsaved-changes protection.
- RAG status (red/amber/green) per task.
- Dark mode (Light/Dark/System), independent of print (always light) and
  static export (bakes in the theme active at export time).
- Copy/paste for date fields (in-memory, Ctrl/Cmd+C/V while a date field is
  focused).
- Example test harness in `tests/` (jsdom functional tests, Playwright
  visual/print tests); dev tooling, not bundled into the app.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `backlog.md`, and a GitHub Actions
  release workflow that publishes a GitHub Release with the bare HTML file
  attached whenever `main` is tagged `vX.Y.Z`.
- Version number and an About panel (GitHub link, version, license) in the
  app header, with a best-effort check against the GitHub Releases API for
  a newer version.

[Unreleased]: https://github.com/sam-ward/timeline/compare/v1.3.2...HEAD
[1.3.2]: https://github.com/sam-ward/timeline/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/sam-ward/timeline/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/sam-ward/timeline/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/sam-ward/timeline/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/sam-ward/timeline/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/sam-ward/timeline/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/sam-ward/timeline/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/sam-ward/timeline/releases/tag/v1.0.0

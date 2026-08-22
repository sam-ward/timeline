# Verification schedule

`verification-schedule.json` is a hand-built fixture that exercises every
major feature and visual state of `timeline-schedule-tool.html` in one file.
Open it via **Open…** (or drag-and-drop, once that lands) to manually
eyeball a change across the Task List, Gantt Chart, and Dashboard without
having to hand-build test data each time.

It's a manual-verification aid, not an automated test; see `tests/` for
those. Each task's own `description` field explains what it's there to
demonstrate, so the fastest way to understand it is to open it in the app
and read the descriptions in the edit modal / hover tooltips as you go.

## What it covers

- **Hierarchy**: 3 levels deep (`Phase 2` → `Backend Development` →
  `API Endpoints`), for dependency-picker indentation and Task List nesting.
- **Dependencies**: same-branch chains, a leaf depending on a whole parent
  task in another branch, cross-branch (sibling-subtree) dependencies, and
  a milestone with two predecessors at once. Also a positive dependency lag
  (`ph2-be-db`, "+2d" — starts 2 working days after its predecessor, not the
  next working day) and a negative one/lead time (`ph2-fe-ui`, "-1d" —
  starts before its predecessor is fully finished).
- **Milestones**: both completed (done, filled diamond) and not-yet-reached
  (open diamond) states.
- **Parent/summary rollups**: dates, %, and resources computed from children.
- **RAG status**: all three colors plus "not set", including on a parent
  task.
- **Dashboard buckets**: Overdue, In Progress (current), Upcoming Tasks,
  Upcoming Milestones, and Completed are all populated.
- **Resource handling**: multi-resource tasks, a case-variant name
  (`carol` vs `Carol`) to check canonicalization, and unassigned tasks (for
  the Dashboard's "Unassigned" card).
- **Manual end date**: one task with `manualEnd: true`, where duration is
  derived from the date range instead of the other way around.
- **Holidays**: a few dates set, one of which falls inside a task's date
  range, to check Gantt shading and that they're skipped in duration math.
- **Collapsed state**: `Phase 3` saves/loads already collapsed. Its milestone
  child (`ph3-launch`, "Go Live") should still render as a small ringed
  diamond rolled up onto Phase 3's own collapsed Gantt bar rather than just
  disappearing, with a dependency arrow still drawn to `misc-post-launch-review`
  (which depends on it, outside the collapsed branch).
- **Edge cases**: a blank task name (checks the `displayName()` fallback to
  "Untitled task" in read-only views vs. the placeholder in editable
  fields) and a deliberately long task name (checks wrapping/truncation).
- **Tags**: `PO` and `DOC` both used on more than one task, across every task
  type — a parent (`ph1`, `DOC`), a milestone (`ph1-design`, `PO`; `ph3-launch`,
  `DOC`), and a regular leaf task (`misc-longname`, `PO`) — and deliberately
  *not* matching between `ph1` and its child `ph1-design`, to demonstrate tags
  don't roll up to parents the way resources do.

## Keeping it current

Dates are anchored close to when this fixture was last refreshed (currently
late August 2026), so today's date lands roughly a third of the way through
the schedule and the Dashboard buckets land in sensible places (some overdue,
some in progress, some upcoming). They'll drift over time — eventually
everything will read as "overdue," and the Gantt's Today marker will end up
off toward the far end of the chart instead of with useful context on both
sides. If that's happened, shift every task's `start`/`end` and every
`holidays` entry forward by the same number of days (a small script that
does this by editing only those date-shaped strings, not a full JSON
parse/stringify round-trip — that reformats every array onto multiple
lines and turns a one-line diff into a noisy one) so today lands around the
first third of the range again, and bump `meta.created`/`meta.modified` to
reflect the refresh.

If you add or change a feature, update this fixture (and this README) in
the same pass; see the reminder in `ARCHITECTURE.md`.

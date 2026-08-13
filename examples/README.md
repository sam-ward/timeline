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
  a milestone with two predecessors at once.
- **Milestones**: both completed (done, filled diamond) and not-yet-reached
  (open diamond) states.
- **Parent/summary rollups**: dates, %, and resources computed from children.
- **RAG status**: all three colors plus "not set", including on a parent
  task.
- **Dashboard buckets**: Overdue, In Progress (current), Upcoming, and
  Completed are all populated.
- **Resource handling**: multi-resource tasks, a case-variant name
  (`carol` vs `Carol`) to check canonicalization, and unassigned tasks (for
  the Dashboard's "Unassigned" card).
- **Manual end date**: one task with `manualEnd: true`, where duration is
  derived from the date range instead of the other way around.
- **Holidays**: a few dates set, one of which falls inside a task's date
  range, to check Gantt shading and that they're skipped in duration math.
- **Collapsed state**: `Phase 3` saves/loads already collapsed.
- **Edge cases**: a blank task name (checks the `displayName()` fallback to
  "Untitled task" in read-only views vs. the placeholder in editable
  fields) and a deliberately long task name (checks wrapping/truncation).

## Keeping it current

Dates are anchored close to when this fixture was last written (mid-August
2026) so the Dashboard buckets land in sensible places. They'll drift over
time. Eventually everything will read as "overdue." If that happens, either
regenerate the dates (shift every task's date fields forward by the same
offset) or check the fixture's `meta.created` date against today and treat
bucket placement loosely if it's been more than a few months.

If you add or change a feature, update this fixture (and this README) in
the same pass; see the reminder in `ARCHITECTURE.md`.

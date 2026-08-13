# Backlog

Working list of known bugs, planned improvements, and process/infra work for
`timeline-schedule-tool.html`. Update this file as items are picked up,
completed, or reprioritized. It's the shared source of truth for what's
next, not a historical record (that's what `CHANGELOG.md` and git history
are for).

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done (move to
Changelog and remove from here once released).

## Bugs

None currently open. The last batch (Gantt "Today" scroll, RAG red/amber
contrast, live status dot, arrow-key focus loss, stale selection-highlight
repaint) shipped in `v1.0.1`; see `CHANGELOG.md` for details.

## Improvements

1. [x] Copy/paste for dates already exists (Ctrl/Cmd+C/V on a focused date
   field) but isn't discoverable. Fixed with a hover tooltip on the Task
   List's date fields explaining the shortcut. Table only, not the edit
   modal's date fields (which don't have the shortcut wired up); see
   `CHANGELOG.md`'s `[Unreleased]` section.
2. [ ] **Needs a design discussion before any code.** Support durations
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
3. [ ] Drag-and-drop a `.json` schedule file onto the already-open window to
   open it (in addition to the existing Open button/file picker).
4. [ ] Dashboard: separate "upcoming tasks" from "upcoming milestones" in the
   relevant bucket, rather than listing them together. (Tentative, worth
   confirming the exact desired grouping before building.)
5. [ ] **Needs a design discussion before any code.** Auto-scheduling via
   dependencies is useful but currently conflates two different concerns:
   dependency logic (what must finish before what) and timing/sequencing
   (when things should actually happen). Possible directions: allow a manual
   start-date override even when a dependency exists, a separate lead/lag
   field, or something else. Explicitly parked until the smaller items below
   are cleared; revisit then.

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

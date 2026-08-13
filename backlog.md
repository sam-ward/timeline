# Backlog

Working list of known bugs, planned improvements, and process/infra work for
`timeline-schedule-tool.html`. Update this file as items are picked up,
completed, or reprioritized. It's the shared source of truth for what's
next, not a historical record (that's what `CHANGELOG.md` and git history
are for).

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done (move to
Changelog and remove from here once released).

## Bugs

1. [x] Gantt "Today" button under-scrolls. **Fixed.** Was landing ~200px
   before today's marker using a hardcoded offset that didn't account for
   the sticky task-label column's actual width. Now computes the offset
   from the real label column width instead of a magic number.
2. [x] RAG status red vs. amber were too close in hue/lightness to tell
   apart at a glance (`--danger:#B3412D` vs `--warn:#C7622A`, both muted
   brick/rust tones). **Fixed.** New red is 24° of hue separation from
   amber instead of 12°, plus higher saturation, updated across all four
   theme locations (light, dark media query, dark data-theme, print).
3. [x] Task edit modal: changing the RAG Status dropdown didn't update the
   dot's color live, only visible after save + reopen. **Fixed**, following
   the same reactive-refresh pattern as the existing
   `refreshMilestoneUI()`/`refreshStartLock()` functions.
4. [x] Arrow-key increment/decrement on date/duration fields only
   registered one keypress before losing focus. **Fixed.** Root cause:
   arrow-key stepping fires `change` while the field is still focused, and
   the full-table rebuild that `change` triggers destroyed the still-focused
   input. Now refocuses the freshly-rendered replacement, but only when the
   field was still focused at commit time, so tabbing/clicking away still
   works normally.
5. [x] Date field usability: selecting a date field's text (3–4 clicks to
   select-all) left the text visually highlighted after clicking away, until
   focusing another text/date field. **Fixed.** First attempt to reproduce
   (blurring by clicking into another text field) didn't show it; turned
   out that's specifically the one thing that *does* clear it, per the
   user's own repro steps. Re-tested blurring onto a non-field area instead
   and reproduced it immediately, screenshot-confirmed: DOM state
   (`document.activeElement`, `selectionStart`/`End`) is correctly cleared
   the instant focus moves away, but the browser doesn't repaint that field.
   The stale "selected" highlight stays visibly painted until something
   else forces a repaint nearby (e.g. focusing a different field). A
   genuine stale-paint bug in the browser's rendering of native form
   controls, confirmed by the user on both Chrome and Firefox, both Windows
   and Linux. Generic repaint nudges (toggling opacity/transform/display/
   disabled) did not clear it; what did: momentarily clearing and restoring
   the field's own `.value` on blur, which forces the control to fully
   redraw its internal text representation. See the "INPUT BLUR REPAINT
   WORKAROUND" section in the script for the fix and reasoning.

## Improvements

1. [ ] Copy/paste for dates already exists (Ctrl/Cmd+C/V on a focused date
   field) but isn't discoverable; user didn't know it was there. Consider a
   hint/tooltip, or otherwise surfacing it. (See bug 5 above for a related
   usability rough edge in the same area.)
2. [ ] Support durations smaller than 1 working day (e.g. half-days). Bigger
   change, touches `recalcAll()`, `sanitizeDuration()`, and brushes against
   the `duration === 0` milestone convention. Needs a short design pass
   before implementation, not just a drive-by fix.
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

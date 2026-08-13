# AGENTS.md

Standing instructions for any AI agent (Claude Code or otherwise) working in this repository.
Read this first, then `ARCHITECTURE.md` for how the code itself actually works. This file is
rules, not narrative — if you're looking for project history, see git history and `CHANGELOG.md`
instead.

## What this project is

A single self-contained HTML file (`timeline-schedule-tool.html`) — a Gantt-chart / project
scheduler with **no build step, no bundler, no framework, and no external runtime dependency**.
It opens by double-clicking it. This is a deliberate, load-bearing constraint, not an oversight —
see "Why a single file?" at the end of `ARCHITECTURE.md` before suggesting one of those things.
Any change you make must preserve it.

## Before you start

- Read `ARCHITECTURE.md` in full before editing `timeline-schedule-tool.html` — it documents real,
  non-obvious gotchas (print/sticky-positioning, CSS specificity, focus-stealing re-renders,
  circular-dependency scheduling) that are easy to reintroduce if you don't know they happened.
- Check `backlog.md` for what's already known/pending before assuming something is new.

## Working discipline (non-negotiable)

1. **Test every change before calling it done.**
   - Logic / scheduling / data-model changes: `node tests/jsdom-functional-tests.js`.
   - Anything visual, print, dark-mode, or Gantt-rendering related:
     `node tests/playwright-visual-tests.js` too — jsdom can't apply `@media print` or do real
     layout, so it can't catch everything.
   - "It should work" or "looks correct on inspection" is not verification. Run it, read the
     actual output, look at the actual screenshot/PDF.
2. **Print changes specifically:** generate a real PDF and look at it. Print rendering has a
   history of looking correct in code and not being correct until actually rendered — see
   `ARCHITECTURE.md`'s "Printing the Gantt chart" section.
3. **Update documentation in the same pass as the code change**, not as a follow-up:
   - `ARCHITECTURE.md` for anything about how the code works or why.
   - `examples/verification-schedule.json` (and `examples/README.md`) if you add, change, or
     remove a feature or visual state — it exists to exercise everything the app does; if it goes
     stale it stops being useful. See the pointer in `ARCHITECTURE.md`'s "Common tasks for future
     changes".
   - `CHANGELOG.md`'s `[Unreleased]` section for anything user-visible.
   - `backlog.md` — update status as you go rather than letting it drift from reality.
4. **If a reported bug doesn't reproduce** after a genuine attempt, say so plainly — "I can't
   reproduce this, here's what I tried" — rather than guessing at a change and calling it fixed.

## Process

- Branching: feature branches → PR → `main`. No persistent `dev` branch, no committing straight to
  `main`. See `CONTRIBUTING.md`.
- Releases are cut by tagging `main` (`vX.Y.Z`, semantic versioning), which triggers
  `.github/workflows/release.yml`. Full steps in `CONTRIBUTING.md`.
- `backlog.md` is the live source of truth for pending bugs/improvements/infra work — keep it
  current rather than letting state live only in chat.

## Things that need explicit sign-off, every time

Doing local work (commits, branches, running tests) does not imply permission for anything
outward-facing. Always confirm before:

- `git push` of any branch, or opening a PR.
- Tagging a release, or pushing a tag.
- Changing a GitHub repo setting (branch protection, etc.).
- Anything else other people would see or be affected by — this project already has other users.

Approval for one of these doesn't carry over to the next one — ask again each time, don't assume
standing permission.

## Where things live

- `README.md` — user-facing docs.
- `ARCHITECTURE.md` — how the code works; read before touching `timeline-schedule-tool.html`.
- `CONTRIBUTING.md` — branching and release process.
- `CHANGELOG.md` — what shipped, per release.
- `backlog.md` — what's pending.
- `examples/verification-schedule.json` (+ `examples/README.md`) — manual verification fixture;
  keep it current.
- `tests/` — dev-only jsdom + Playwright harnesses; see `tests/README.md`.

This file is the ratified version of working agreements that used to live only in a one-off
session handoff document. Keep it current the same way: if a new working agreement gets made in
conversation, fold it in here rather than letting it live only in chat history.

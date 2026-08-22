# Contributing

## Branching

- `main` is always releasable.
- Every change (bug fix, tweak, feature) gets its own short-lived branch off
  `main`, named for what it does, e.g. `fix/gantt-today-scroll` or
  `feat/dashboard-milestone-split`.
- Open a PR into `main` when it's ready. Merge once it's reviewed and, per
  the working discipline in `AGENTS.md`/`ARCHITECTURE.md`, actually tested
  (jsdom for logic, Playwright for anything visual/print/dark-mode-related;
  see `tests/README.md`).
- No persistent `dev` branch. Keep branches short-lived and merge them, so
  `main` doesn't drift far from what's actually shipped.
- `main` is protected on GitHub: no force-pushes, no deletion, and pushes
  from anyone other than a repo admin must come through a PR. See "Direct
  pushes to main" below for the one narrow exception.

## Direct pushes to main

Repo admins are exempt from the PR requirement on `main`. GitHub allows it,
but that's a bypass for genuine housekeeping, not a default. Use it only
for a **standalone** change that doesn't touch app behavior or the process
itself:

- Fixing a typo or updating a screenshot in `README.md`.
- Anything else purely editorial, with no code behind it.

**Everything else still goes through a branch and a PR, no exceptions,**
in particular:

- Any change to `timeline-schedule-tool.html`, `.github/workflows/*`,
  `CONTRIBUTING.md`, or `AGENTS.md`.
- **`CHANGELOG.md` or docs updates that result from a feature or bug fix.**
  Those ride along in the same branch/PR as the code that motivated them,
  never split out and pushed to `main` on their own, even though the
  changelog entry itself is "just docs." The point is that a PR should tell
  the whole story of a change, changelog included; splitting it defeats
  that.

If you're not sure whether something qualifies as standalone housekeeping,
default to a branch + PR. The bypass exists to remove friction from
trivial cases, not to become the normal path.

## Cutting a release

Releases are tagged commits on `main`, built automatically by
`.github/workflows/release.yml`. Versioning follows
[semantic versioning](https://semver.org/) (`vMAJOR.MINOR.PATCH`).

1. On your PR branch (or a small dedicated release-prep branch off `main`
   once everything you want in the release is merged):
   - Bump `APP_VERSION` in `timeline-schedule-tool.html` (search for
     `const APP_VERSION`).
   - Move the relevant entries from the `## [Unreleased]` section of
     `CHANGELOG.md` into a new `## [X.Y.Z] - YYYY-MM-DD` section, and add
     compare-link references at the bottom of the file.
2. Merge that PR into `main`.
3. Tag `main` and push the tag:
   ```
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. The `Release` workflow picks up the tag, verifies `APP_VERSION` in the
   HTML matches it, pulls that version's notes out of `CHANGELOG.md`, and
   publishes a GitHub Release with the bare HTML file attached (GitHub
   already generates a "Source code (zip/tar.gz)" download on every release
   automatically from the tag, so the workflow doesn't need to build its
   own repo snapshot). If the version check fails, the workflow fails
   loudly instead of publishing a mismatched release; fix the version in
   the HTML (or the tag) and re-tag.

The app's own About panel (ℹ️ button in the header) checks the GitHub
Releases API against the running `APP_VERSION` and flags when a newer
release exists, so tagging is what actually notifies users of an update.
Don't skip it even for small fixes if you want existing users to see it.

## Testing

There's no build step and no runtime test suite bundled in the HTML file
itself (that would add a dependency, which defeats the point; see "Why a
single file?" in `ARCHITECTURE.md`). There is a dev-only example test
harness in `tests/`; see `tests/README.md` for setup and what each script
checks. Run both before opening a PR that touches app behavior:

```
cd tests
npm install jsdom playwright
npx playwright install chromium   # only needed once
node jsdom-functional-tests.js
node playwright-visual-tests.js
```

## Git hooks (optional, but recommended once per clone)

```
git config core.hooksPath .githooks
```

Enables `.githooks/pre-commit`, which keeps `examples/verification-schedule.json`'s dates fresh
automatically — every commit, it checks whether "today" has drifted from a sensible spot in the
fixture's date range and, if so, shifts every date in the file (not a from-scratch regeneration, so
real edits made while testing a feature are preserved) and folds the update into the commit. Never
blocks a commit; see `tests/refresh-verification-fixture-dates.js` for the actual logic, and the
"Keeping it current" section of `examples/README.md` for why this exists.

Git hooks aren't version-controlled by default (`.git/hooks/` isn't part of the repo), which is why
this needs the one-time `core.hooksPath` config rather than just working out of the box — `.githooks/`
being a real, tracked directory is what makes it possible to check the hook itself into the repo at
all.

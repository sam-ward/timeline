# Contributing

## Branching

- `main` is always releasable. Don't commit straight to it.
- Every change (bug fix, tweak, feature) gets its own short-lived branch off
  `main`, named for what it does, e.g. `fix/gantt-today-scroll` or
  `feat/dashboard-milestone-split`.
- Open a PR into `main` when it's ready. Merge once it's reviewed and, per
  the working discipline in `HANDOFF.md`/`ARCHITECTURE.md`, actually tested
  (jsdom for logic, Playwright for anything visual/print/dark-mode-related —
  see `tests/README.md`).
- No persistent `dev` branch — keep branches short-lived and merge them, so
  `main` doesn't drift far from what's actually shipped.

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
   publishes a GitHub Release with the bare HTML file and a zip of the repo
   attached. If the version check fails, the workflow fails loudly instead
   of publishing a mismatched release — fix the version in the HTML (or the
   tag) and re-tag.

The app's own About panel (ℹ️ button in the header) checks the GitHub
Releases API against the running `APP_VERSION` and flags when a newer
release exists, so tagging is what actually notifies users of an update —
don't skip it even for small fixes if you want existing users to see it.

## Testing

There's no build step and no runtime test suite bundled in the HTML file
itself (that would add a dependency, which defeats the point — see "Why a
single file?" in `ARCHITECTURE.md`). There is a dev-only example test
harness in `tests/` — see `tests/README.md` for setup and what each script
checks. Run both before opening a PR that touches app behavior:

```
cd tests
npm install jsdom playwright
npx playwright install chromium   # only needed once
node jsdom-functional-tests.js
node playwright-visual-tests.js
```

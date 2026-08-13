# Changelog

All notable changes to Timeline are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Task List date fields now show a tooltip on hover explaining the
  Ctrl/Cmd+C / Ctrl/Cmd+V copy-paste shortcut, which previously had no
  visible indication it existed. Only shown on editable (unlocked) date
  fields, since locked ones are `disabled` and can't be focused to use
  the shortcut at all.
- Drag a `.json` schedule file onto the window to open it, alongside the
  existing Open button/file picker.

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

[Unreleased]: https://github.com/sam-ward/timeline/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/sam-ward/timeline/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/sam-ward/timeline/releases/tag/v1.0.0

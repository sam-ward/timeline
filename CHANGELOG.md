# Changelog

All notable changes to Timeline are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `CHANGELOG.md`, `CONTRIBUTING.md`, `backlog.md` and a GitHub Actions
  release workflow.
- Version number and an About panel (GitHub link, version, license) in the
  app header, with a best-effort check against the GitHub Releases API for
  a newer version.

## [1.0.0] - 2026-08-13

Baseline release — the app as it stood before the release process existed,
covering everything built up to this point.

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
  visual/print tests) — dev tooling, not bundled into the app.

[Unreleased]: https://github.com/sam-ward/timeline/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/sam-ward/timeline/releases/tag/v1.0.0

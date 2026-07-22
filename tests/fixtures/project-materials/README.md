# Portable project-material fixtures

This directory contains the minimum versioned, byte-for-byte project materials needed by repository tests.

- Source: the reviewed project artifacts named by each migrated test.
- Purpose: make unit and contract tests independent from a developer's Workspace layout.
- Boundary: tests must resolve files through `tests/helpers/project-materials.ts`.
- Fail-closed: missing files, path traversal, absolute paths, and declared hash drift are errors.
- Excluded: credentials, databases, browser profiles, images, logs, and unrelated historical artifacts.

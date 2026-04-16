# Automation

## Upstream sync

Workflow: `.github/workflows/upstream-sync.yml`

Behavior:

1. checks latest release from `EveryInc/compound-engineering-plugin`
2. compares it to `upstream.lock.json`
3. if changed, regenerates `skills/`, `prompts/`, and `pi-resources/`
4. writes `docs/generated-release-notes.md`
5. opens or updates an automated PR via `peter-evans/create-pull-request`

Manual dispatch is also supported.

## Release after merge

Workflow: `.github/workflows/release.yml`

Behavior:

1. runs on pushes to `main`
2. reads `package.json` version
3. skips if `v<version>` already exists
4. writes release notes via `scripts/release-from-merge.mjs`
5. creates a GitHub tag + release

The adapter version intentionally tracks the upstream Compound Engineering version in v1.

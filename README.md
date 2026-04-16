# compound-engineering-pi

A maintained, git-installable Pi adapter for [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin).

## What problem this solves

`EveryInc/compound-engineering-plugin` is the source of truth for Compound Engineering, and it already ships a Pi target. Today that Pi target is still experimental for serious day-to-day use:

- upstream conversion currently drops important agent `model` metadata
- the upstream Pi compatibility extension shells subagents without `--model`, `--provider`, or `--thinking`
- users who want Pi need an easier install/update path than manually reworking upstream assets every release

This repo fixes that without attempting a risky v1 rewrite.

## v1 scope

This package focuses on three things:

1. **easy install/update from git**
2. **automated upstream sync from Compound Engineering releases**
3. **model-aware subagents for Pi**

It does **not** try to replace upstream Compound Engineering as the source of truth, and it does **not** implement a full Pi-native runtime rewrite in v1.

## Source of truth

Upstream content lives in:

- `EveryInc/compound-engineering-plugin`

This repo regenerates Pi-facing assets from a pinned upstream tag recorded in [`upstream.lock.json`](./upstream.lock.json).

## Install

Install globally from git:

```bash
pi install git:github.com/ThewindMom/compound-engineering-pi@v2.66.1
```

Or install from a local checkout while iterating:

```bash
pi install /absolute/path/to/compound-engineering-pi
```

## Update

If your package source is not pinned, Pi can update it normally:

```bash
pi update
```

If you pin a specific tag, reinstall or change the tag explicitly:

```bash
pi install git:github.com/ThewindMom/compound-engineering-pi@v2.66.1
```

## Global model config

v1 intentionally supports **global-only** model configuration.

Copy [`ce-models.json`](./ce-models.json) to:

```bash
~/.pi/agent/compound-engineering/ce-models.json
```

Then edit it to set:

- global defaults
- role-level overrides (`research`, `review`, `workflow`, etc.)
- specific agent overrides

Resolution order in v1:

1. explicit global agent override
2. explicit global role/default override
3. upstream agent metadata when present
4. adapter defaults
5. Pi's normal default model

See [docs/model-config.md](./docs/model-config.md).

## Package contents

- `extensions/compound-engineering-compat.ts` — maintained Pi adapter extension
- `skills/` — copied upstream skills plus generated agent skills
- `prompts/` — generated prompt wrappers for upstream CE skills
- `pi-resources/compound-engineering/agent-metadata.json` — generated upstream metadata used for model routing
- `scripts/build-from-upstream.mjs` — deterministic asset regeneration
- `scripts/sync-upstream.mjs` — detect new upstream release and regenerate assets
- `scripts/release-from-merge.mjs` — prepare release tag/release notes metadata

## Automation

Two GitHub Actions workflows are included:

- `.github/workflows/upstream-sync.yml`
  - cron + manual dispatch
  - checks latest upstream release
  - rebuilds generated assets
  - opens or updates an automated PR
- `.github/workflows/release.yml`
  - runs on merge to `main`
  - creates a `vX.Y.Z` tag and GitHub release when that tag does not already exist

See [docs/automation.md](./docs/automation.md).

## Safe validation note

Before any validation that touches the real `~/.pi`, make a complete backup first.

See [docs/validation.md](./docs/validation.md).

## Local development

Rebuild from a local upstream checkout:

```bash
node scripts/build-from-upstream.mjs --source /path/to/compound-engineering-plugin
```

Dry-run upstream sync logic:

```bash
node scripts/sync-upstream.mjs --force
```

Run tests:

```bash
npm test
```

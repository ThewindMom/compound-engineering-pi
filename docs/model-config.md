# Global model config

v1 uses a **global-only** config file:

```text
~/.pi/agent/compound-engineering/ce-models.json
```

This keeps the first release simple and predictable.

## Starting point

Copy the template shipped by this repo:

```bash
mkdir -p ~/.pi/agent/compound-engineering
cp ce-models.json ~/.pi/agent/compound-engineering/ce-models.json
```

## Shape

```json
{
  "defaults": {
    "thinking": "medium"
  },
  "roles": {
    "research": {
      "thinking": "high"
    }
  },
  "agents": {
    "security-reviewer": {
      "model": "sonnet",
      "thinking": "high"
    }
  }
}
```

Supported fields per block:

- `model`
- `provider`
- `thinking`

## Resolution order

For a CE subagent invocation, the adapter resolves model settings in this order:

1. global `agents.<name>` override
2. global `roles.<role>` override
3. global `defaults`
4. upstream agent metadata (`model:` frontmatter) when present and not `inherit`
5. adapter defaults
6. Pi's normal default model selection

Practically, that means your global config always wins.

## Role names

Current generated role groupings come from upstream agent paths, for example:

- `research`
- `review`
- `document-review`
- `workflow`
- `docs`
- `design`

## Why global-only in v1

The first release optimizes for:

- easy installation
- easy updates
- predictable behavior
- one obvious place for users to edit model routing

Project-local overrides can be added later if needed, but they are intentionally out of scope for v1.

# Validation and backup

## Mandatory backup rule

Before any validation that touches the real `~/.pi`, create a complete backup of `.pi` first.

Example:

```bash
mkdir -p ~/pi-backups
backup=~/pi-backups/pi-backup-$(date +%Y%m%d-%H%M%S).tar.gz
tar -czf "$backup" -C "$HOME" .pi
printf 'Backup created: %s\n' "$backup"
```

## Recommended validation order

1. run unit tests
2. rebuild generated assets from a pinned upstream checkout
3. validate package loading in a temporary project-local `.pi`
4. only then test against the real global `~/.pi` if needed

## Safer package validation

Prefer a temporary test project over modifying your real global settings first:

```bash
mkdir -p /tmp/cepi-validation
cd /tmp/cepi-validation
pi install -l /absolute/path/to/compound-engineering-pi
```

That writes to the local test project's `.pi/settings.json` instead of your global Pi config.

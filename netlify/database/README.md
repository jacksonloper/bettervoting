# `netlify/database/`

**This directory is intentionally minimal — do NOT add a `migrations/`
subdirectory here.**

## Why

Netlify DB ships with a native migration system that looks for SQL files
under `netlify/database/migrations/` and applies them automatically at
deploy time. BetterVoting has its own Kysely-based migration system that
predates Netlify DB and is the source of truth for the schema:

```
packages/backend/src/Migrations/
├── 2023_07_03_Initial.ts
├── 2024_01_27_Create_Date.ts
├── 2024_01_29_pkeys_and_heads.ts
├── 2025_01_29_admin_upload.ts
├── 2026_03_19_email_events.ts
└── 2026_04_27_unique_head.ts
```

These run from `scripts/netlify-migrate.sh` during the Netlify build,
**before** function code is published. Per Netlify's docs ("bring your
own migrator"), using a separate directory from `netlify/database/migrations/`
keeps the two systems out of each other's way.

## What happens if you add a SQL file to `netlify/database/migrations/`

Netlify's native runner will pick it up and apply it on the next deploy.
Kysely's tracking table (`kysely_migration`) will not know about it, and
Kysely will not know about its tracking either. **You will get silent
schema drift.** Don't do this.

## If you ever want to migrate off Kysely

The right approach would be:

1. Export the current schema with `pg_dump --schema-only`.
2. Drop the Kysely tracking tables (`kysely_migration`, `kysely_migration_lock`).
3. Commit the dump as a single `netlify/database/migrations/0001_baseline.sql`.
4. Delete `packages/backend/src/Migrations/` and the `Migrators/` scripts.
5. Remove the `netlify-migrate.sh` call from `netlify.toml`.

That's a one-way door — keep using Kysely unless there's a strong reason
not to.

## Related

- `NETLIFY_MIGRATION.md` (repo root) — full migration design notes.
- `scripts/netlify-migrate.sh` — the Kysely runner Netlify invokes.
- [Netlify DB migrations docs](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/).

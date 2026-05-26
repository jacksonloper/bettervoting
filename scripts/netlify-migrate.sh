#!/usr/bin/env bash
# Netlify build-time database migration runner.
#
# Why a separate script:
#   - Keeps the netlify.toml build command short and readable.
#   - Lets us fail loudly with actionable messages instead of silently
#     skipping the migration (which would produce a "successful" deploy
#     that crashes at runtime).
#
# How it interacts with Netlify's native migration system:
#   - Netlify DB's built-in migration runner looks for SQL files under
#     `netlify/database/migrations/`. That directory does not exist in this
#     repo (see `netlify/database/README.md`), so the native runner is a
#     no-op. We use Kysely instead, which lives at
#     `packages/backend/src/Migrations/` and runs from here.

set -euo pipefail

if [ "${BACKEND_PLATFORM:-}" != "netlify" ]; then
  echo "[netlify-migrate] Skipping: BACKEND_PLATFORM=${BACKEND_PLATFORM:-<unset>} (only runs on Netlify builds)."
  exit 0
fi

# Netlify DB exposes the URL under several names depending on context
# (NETLIFY_DATABASE_URL, NETLIFY_DATABASE_URL_UNPOOLED) and @netlify/database
# in turn reads NETLIFY_DB_URL. Normalise here so the migration runner sees
# the same value regardless of which name the platform injected today.
if [ -z "${NETLIFY_DATABASE_URL:-}" ] && [ -n "${NETLIFY_DATABASE_URL_UNPOOLED:-}" ]; then
  export NETLIFY_DATABASE_URL="$NETLIFY_DATABASE_URL_UNPOOLED"
  echo "[netlify-migrate] Using NETLIFY_DATABASE_URL_UNPOOLED (pooled URL not set)."
fi
if [ -z "${NETLIFY_DB_URL:-}" ] && [ -n "${NETLIFY_DATABASE_URL:-}" ]; then
  export NETLIFY_DB_URL="$NETLIFY_DATABASE_URL"
fi

if [ -z "${NETLIFY_DATABASE_URL:-}" ] && [ -z "${NETLIFY_DB_URL:-}" ]; then
  # Fail loud rather than ship a deploy that 500s at runtime with
  # `relation "electionDB" does not exist`. If the DB really hasn't been
  # provisioned yet, fix it in the UI (Project configuration → Database)
  # or `netlify db init` from a linked clone, then retry the deploy.
  echo "[netlify-migrate] ERROR: no Netlify DB URL visible to this build." >&2
  echo "" >&2
  echo "[netlify-migrate] Diagnostic — env keys with DATABASE / NETLIFY / NEON / DB in their name:" >&2
  env | awk -F= '/DATABASE|NETLIFY|NEON|^DB_/ { print "  - " $1 }' | sort -u >&2 || true
  echo "" >&2
  cat >&2 <<'EOF'
The Kysely migration runner needs a connection string at build time.
Common causes:

  1. Database not attached to this site yet — go to Project configuration
     → Database in the Netlify UI, or run `netlify db init` from a linked
     local clone.
  2. The URL exists but is scoped only to some deploy contexts — check
     Project configuration → Environment variables and make sure
     NETLIFY_DATABASE_URL is enabled for Builds.
  3. First build after install — re-run the deploy; the URL is only
     present on builds *after* the package's first deploy.
EOF
  exit 1
fi

echo "[netlify-migrate] Running Kysely migrations against Netlify DB..."
exec npm run migrate:latest -w @equal-vote/star-vote-backend

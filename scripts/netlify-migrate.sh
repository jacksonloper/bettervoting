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

# Netlify DB exposes both a pooled and an unpooled connection string. Either
# works for one-shot migrations, so accept whichever the build environment
# happens to inject.
if [ -z "${NETLIFY_DATABASE_URL:-}" ] && [ -n "${NETLIFY_DATABASE_URL_UNPOOLED:-}" ]; then
  export NETLIFY_DATABASE_URL="$NETLIFY_DATABASE_URL_UNPOOLED"
  echo "[netlify-migrate] Using NETLIFY_DATABASE_URL_UNPOOLED (pooled URL not set)."
fi

if [ -z "${NETLIFY_DATABASE_URL:-}" ]; then
  # Chicken-and-egg: Netlify only auto-provisions the DB on the first build
  # that ships @netlify/database, so the very first build can't see the env
  # var yet. We log loudly and exit 0 so the deploy succeeds; the next
  # build will have the URL and will actually apply migrations.
  echo "[netlify-migrate] WARNING: no Netlify DB URL visible to this build — skipping migrations." >&2
  echo "" >&2
  echo "[netlify-migrate] Diagnostic — env vars visible to this build with names containing DATABASE / NETLIFY / NEON:" >&2
  # Print names only (not values) so we don't leak secrets into build logs.
  env | awk -F= '/DATABASE|NETLIFY|NEON/ { print "  - " $1 }' | sort -u >&2 || true
  echo "" >&2
  cat >&2 <<'EOF'
If this is the first deploy with @netlify/database installed, that's
expected — Netlify will provision the database during this deploy and
the next build will see NETLIFY_DATABASE_URL.

If you've already had a successful deploy and the URL is still missing:
  1. `netlify database status` from a linked local clone — confirms whether
     the database is enabled and what its connection string is.
  2. Site dashboard → Project configuration → Database — links a database
     manually if auto-provisioning hasn't fired.
  3. Site dashboard → Project configuration → Environment variables —
     check that NETLIFY_DATABASE_URL is enabled for this deploy context
     (Production / Deploy Preview / Branch deploys).
EOF
  exit 0
fi

echo "[netlify-migrate] Running Kysely migrations against Netlify DB..."
exec npm run migrate:latest -w @equal-vote/star-vote-backend

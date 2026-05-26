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
  echo "[netlify-migrate] ERROR: BACKEND_PLATFORM=netlify but no Netlify DB URL is visible to the build." >&2
  echo "" >&2
  echo "[netlify-migrate] Diagnostic — env vars visible to this build with names containing DATABASE / NETLIFY / NEON:" >&2
  # Print names only (not values) so we don't leak secrets into build logs.
  env | awk -F= '/DATABASE|NETLIFY|NEON/ { print "  - " $1 }' | sort -u >&2 || true
  echo "" >&2
  cat >&2 <<'EOF'
If you see NETLIFY_DATABASE_URL in the list above but it's still treated as
empty here, it's probably scoped to a different deploy context than this
build (e.g. set for Production only while this is a Deploy Preview).

If you don't see it at all, the Neon/Netlify-DB integration hasn't injected
it into the site yet. Common fixes:

  1. Site settings → Integrations → Neon (or "Netlify DB") → make sure the
     database is linked to this site and that "Expose connection string as
     environment variable" is enabled.
  2. Site settings → Environment variables → confirm NETLIFY_DATABASE_URL
     is listed and that the deploy context for this build is checked.
  3. Locally: `netlify link` to this site, then `netlify env:list` to see
     what's actually exposed. `netlify database status` confirms the DB is
     attached.
  4. As a fallback you can set DATABASE_URL manually under Environment
     variables (ServiceLocator falls through to DATABASE_URL if
     NETLIFY_DATABASE_URL isn't set).
EOF
  exit 1
fi

echo "[netlify-migrate] Running Kysely migrations against Netlify DB..."
exec npm run migrate:latest -w @equal-vote/star-vote-backend

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

if [ -z "${NETLIFY_DATABASE_URL:-}" ]; then
  cat >&2 <<'EOF'
[netlify-migrate] ERROR: BACKEND_PLATFORM=netlify but NETLIFY_DATABASE_URL is empty.

This usually means Netlify DB has not been provisioned yet. From a local
clone of the repo, run:

    netlify database init

then push again. The connection string is injected into the build
environment automatically once the database exists.
EOF
  exit 1
fi

echo "[netlify-migrate] Running Kysely migrations against Netlify DB..."
exec npm run migrate:latest -w @equal-vote/star-vote-backend

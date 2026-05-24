# Netlify Backend Migration — Experiment

This branch experiments with replacing the **entire** BetterVoting backend
with Netlify-native services:

| Old                                | New                                 |
| ---------------------------------- | ----------------------------------- |
| Express on Heroku/Azure            | **Netlify Functions** (`api`)       |
| Keycloak (OIDC)                    | **Netlify Identity** (GoTrue)       |
| Postgres on Azure/Heroku           | **Netlify DB** (Neon)               |
| Azure Blob Storage                 | **Netlify Blobs**                   |
| pg-boss (Postgres job queue)       | **Netlify Background Functions**    |
| socket.io WebSocket server         | _stubbed_ (no persistent sockets)   |

The implementation is gated by `BACKEND_PLATFORM=netlify` (set in
`netlify.toml`). With the env var unset, the existing local dev stack
(Keycloak + Azure + pg-boss + socket.io) continues to work unchanged, so
this branch is non-destructive for contributors who haven't migrated.

## How it's wired

```
                ┌──────────────────────────────────────────────────────┐
                │ Netlify CDN                                          │
   browser ──►  │ /             → packages/frontend/build/index.html   │
                │ /assets/*     → CDN static files                     │
                │ /API/*        → /.netlify/functions/api  (Express)   │
                │ /blob/*       → /.netlify/functions/serve-blob       │
                │ /.netlify/identity/* → GoTrue (managed)              │
                └──────────────────────────────────────────────────────┘
                                  │
                                  ▼
                     ┌────────────────────────────┐
                     │ api function               │
                     │ ─ wraps makeApp() Express  │
                     │ ─ serverless-http          │
                     │ ─ reads NETLIFY_DATABASE_URL│
                     └────────────────────────────┘
                                  │
              publish(...)        │ inline writes (Kysely)
                                  ▼
       ┌──────────────────────┐  ┌──────────────────┐  ┌────────────┐
       │ queue-worker-        │  │ Netlify DB       │  │ Netlify    │
       │ background function  │  │ (Neon Postgres)  │  │ Blobs      │
       │ (15-minute budget)   │  │                  │  │            │
       │ dispatches to        │  │                  │  │            │
       │ registerEvents()     │  │                  │  │            │
       │ handlers             │  │                  │  │            │
       └──────────────────────┘  └──────────────────┘  └────────────┘
```

## What's live

- **All HTTP routes** under `/API/*` — they're served by the same Express app,
  wrapped with `serverless-http`. No route logic changed.
- **Postgres** — `ServiceLocator` reads `NETLIFY_DATABASE_URL` first, with SSL.
  The existing Kysely migrations in `packages/backend/src/Migrations` run at
  deploy time via the build command (only when `NETLIFY_DATABASE_URL` is set).
- **Auth** — `NetlifyAccountService` reads `context.clientContext.user` (which
  Netlify populates from a validated `Authorization: Bearer <nf_jwt>`) and
  emits the same `{sub, email, roles, …}` shape the rest of the code expects.
  The Keycloak code path is unchanged for local dev.
- **Image uploads** — `NetlifyBlobService.uploadBufferToBlob()` stores in
  Netlify Blobs and returns a `/blob/<container>/<key>` URL that resolves via
  the `serve-blob` function. Buffers up to 5 GB are supported.
- **Background jobs** (`castVoteEvent`, `sendInviteEvent`, `sendEmailEvent`) —
  `NetlifyEventQueue.publish()` POSTs to the `queue-worker-background`
  function, which calls the same handlers `registerEvents()` registers in the
  pg-boss flow.
- **Anonymous voters** — `temp_id` cookie path in `extractUserFromRequest`
  still works.

## What's stubbed or different

- **Socket.io** — `setupSockets()` is never called under Netlify (only
  `index.ts` calls it, and `index.ts` isn't loaded by the function). The
  `io != null` guards in `castVoteController.ts` make the broadcasts no-ops.
  Result: the live-updating election stats on the landing page won't update
  until refresh.
  _Possible follow-up:_ swap to a polling REST endpoint, or use Ably/Pusher.
- **pg-boss retries / dedup** — `NetlifyEventQueue` doesn't retry on failure
  and has no `singletonKey` support. If a job throws, it's gone. Acceptable
  for email sends (SendGrid has its own retry) but worth revisiting if we
  start enqueueing critical jobs.
- **`POST /API/Token`** — returns 410 Gone. The Netlify Identity widget
  (`gotrue-js`) exchanges credentials against `/.netlify/identity/token`
  directly, so the backend doesn't proxy it.
- **Per-election custom `auth_key`** — `extractUserFromRequest` ignores the
  `customKey` argument under Netlify. All elections use the site's Identity
  instance. Re-introducing per-election keys would mean storing a separate
  signing secret per election and validating against it.
- **Dynamic OG meta tag injection** — the Express catch-all that injects
  OpenGraph tags into `index.html` per-election ID is bypassed; the SPA
  fallback redirect serves a static `index.html`. Social previews for
  election pages won't show the election title/image until we move the
  injection into an Edge Function.
- **Frontend login UI** — _not yet updated_. The frontend still calls
  Keycloak. For the migration to be testable end-to-end, the login button
  needs to mount the Netlify Identity widget instead. This is the next
  obvious follow-up; flagged as out-of-scope for this branch.

## Deploying

1. In the Netlify UI, enable **Identity** for the site (Site settings →
   Identity → Enable Identity).
2. Run `netlify database init` from the repo root to provision Netlify DB.
   This sets `NETLIFY_DATABASE_URL` automatically in the build environment.
3. Set the standard env vars in Netlify UI:
   - `SENDGRID_API_KEY`
   - `FROM_EMAIL_ADDRESS`
   - `ALLOWED_URLS` (use your `https://<site>.netlify.app`)
   - (optional) `JWT_SECRET` to enable full signature verification on the
     `Authorization` header fallback path.
4. Push this branch. Netlify will:
   - Build the frontend (`packages/frontend/build`).
   - Build the backend (`packages/backend/build`, used by migrations).
   - Run Kysely migrations against `NETLIFY_DATABASE_URL`.
   - Deploy `api`, `serve-blob`, and `queue-worker-background` functions.

## Local-dev parity

`netlify dev` runs everything against Netlify's emulator:

```bash
npx netlify dev
```

This emulates Functions, Identity, Blobs, and serves the frontend dev
server. With `BACKEND_PLATFORM=netlify` set in `.env` you can hit the same
code paths locally.

To keep using the **old** docker-compose stack (Keycloak + local Postgres
+ pg-boss + socket.io), leave `BACKEND_PLATFORM` unset — `ServiceLocator`
will pick the original implementations.

## Files added / changed

```
netlify.toml                                                       (rewritten)
netlify/functions/api.ts                                           (new)
netlify/functions/serve-blob.ts                                    (new)
netlify/functions/queue-worker-background.ts                       (new)
packages/backend/src/Services/Account/NetlifyAccountService.ts     (new)
packages/backend/src/Services/Blob/NetlifyBlobService.ts           (new)
packages/backend/src/Services/EventQueue/NetlifyEventQueue.ts      (new)
packages/backend/src/ServiceLocator.ts                             (branch on env)
packages/backend/src/Controllers/User/getUserTokenController.ts    (410 on netlify)
packages/backend/package.json                                      (+ @netlify/*)
package.json                                                       (+ serverless-http)
NETLIFY_MIGRATION.md                                               (this file)
```

// Netlify Functions 2.0 entrypoint. Exports `default` (a Web Request handler)
// instead of the legacy Lambda-shaped `handler` export. The 2.0 shape lets
// Netlify auto-inject things like NETLIFY_DATABASE_URL into the runtime
// environment that Lambda-compat-mode functions don't get.
//
// hono/netlify provides the `handle(app)` adapter that turns a Hono app into
// exactly the (req, context) => Response shape Netlify Functions 2.0 expects.
//
// env-shim must be imported first so BACKEND_PLATFORM=netlify (and any
// NETLIFY_DB_URL bridging) is set before the backend's ServiceLocator
// captures its runtime config at module load.

import './env-shim';
import { handle } from 'hono/netlify';
import makeApp from '../../packages/backend/src/honoApp';

export default handle(makeApp());

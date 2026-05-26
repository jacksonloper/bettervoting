// Local-dev entrypoint.
//
// Boots the Hono app via @hono/node-server for `npm run dev`. On Netlify the
// function entrypoint is netlify/functions/api.ts, not this file.
//
// Socket.io is gone — it doesn't make sense on a serverless deploy, and the
// only feature using it was the live "elections created" stat on the landing
// page. We accept that regression for the exploration branch.

require('dotenv').config();

import { serve } from '@hono/node-server';
import makeApp from './honoApp';

const app = makeApp();
const port = Number(process.env.BACKEND_PORT ?? 5000);

serve({ fetch: app.fetch, port }, (info) => {
    console.info(`Server started on port ${info.port}`);
});

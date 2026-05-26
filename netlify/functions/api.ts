// Netlify Function wrapper around the existing Express app.
//
// We import the Express app factory from packages/backend and wrap it with
// serverless-http. The redirect rules in netlify.toml send all /API/* and
// /api/* traffic here. The function runs synchronously (Netlify's 26-second
// budget is enforced via netlify.toml).
//
// The Netlify `context.clientContext` (which holds the Identity user when a
// valid JWT is on the request) is attached to the Express `req` object so the
// NetlifyAccountService can read it without re-verifying the JWT.

import serverless from 'serverless-http';
import type { Handler, HandlerContext, HandlerEvent } from '@netlify/functions';

import makeApp from '../../packages/backend/src/app';

const app = makeApp();

const wrapped = serverless(app, {
  request: (req: any, event: HandlerEvent, context: HandlerContext) => {
    // Make the Netlify Identity user available to AccountService middleware.
    req.clientContext = (context as any).clientContext ?? null;
    req.netlifyEvent = event;
    req.netlifyContext = context;
  },
});

export const handler: Handler = async (event, context) => {
  // serverless-http types are slightly off from @netlify/functions, but the
  // call shape is compatible at runtime.
  return wrapped(event, context) as any;
};

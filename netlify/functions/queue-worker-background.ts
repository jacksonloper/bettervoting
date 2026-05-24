// Background function that processes queued jobs (email sends, etc.).
//
// The `-background` suffix is Netlify's convention for background functions:
// they always return 202 to the caller and run up to 15 minutes.
//
// NetlifyEventQueue.publish() POSTs to /.netlify/functions/queue-worker-background
// with `{ queue, data }`. We look up the handler that was registered at app
// startup (registerEvents) and call it.

import type { Handler } from '@netlify/functions';

import registerEvents from '../../packages/backend/src/Routes/registerEvents';
import { dispatchJob } from '../../packages/backend/src/Services/EventQueue/NetlifyEventQueue';

// Ensure handlers are registered. registerEvents() is idempotent because the
// queue stores handlers in a singleton map.
let registered: Promise<void> | null = null;
function ensureRegistered() {
  if (!registered) registered = registerEvents();
  return registered;
}

export const handler: Handler = async (event) => {
  await ensureRegistered();

  if (!event.body) {
    return { statusCode: 400, body: 'missing body' };
  }

  const { queue, data, id } = JSON.parse(event.body);
  await dispatchJob(queue, { id: id ?? 'bg-' + Date.now(), data: data ?? {} });

  // Background functions return immediately to the publisher; this response
  // is for log-tailing only.
  return { statusCode: 200, body: 'ok' };
};

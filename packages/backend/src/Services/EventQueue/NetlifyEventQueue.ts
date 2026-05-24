// Netlify replacement for the pg-boss event queue.
//
// pg-boss requires a long-lived process polling Postgres, which doesn't fit
// the serverless model. Instead:
//   - publish() POSTs the job to /.netlify/functions/queue-worker-background
//     (a Netlify background function with a 15-minute timeout). The publisher
//     gets a 202 immediately and continues.
//   - subscribe() registers an in-process handler in a module-level map. When
//     the background function runs, it imports registerEvents() (idempotent)
//     to populate the map, then dispatches the job to the right handler.
//
// Trade-offs vs pg-boss:
//   + No Postgres polling, no separate worker process.
//   + Each job runs in its own warm/cold Lambda — natural isolation.
//   - No retries on failure (would need an outer retry wrapper or a deferred
//     queue, e.g. invoking ourselves again with a delay).
//   - No deduplication / singletonKey.
//   - No `countStates` for debugInfo.

import Logger from '../Logging/Logger';
import { EventHandler, IEventQueue } from './IEventQueue';
import { QueueName } from './QueueName';

const HANDLERS = new Map<QueueName, EventHandler>();

/** Called by the background function to run a queued job. */
export async function dispatchJob(
  queue: QueueName,
  job: { id: string; data: object },
): Promise<void> {
  const handler = HANDLERS.get(queue);
  if (!handler) {
    Logger.warn({}, `NetlifyEventQueue: no handler registered for queue=${queue}`);
    return;
  }
  await handler(job);
}

export default class NetlifyEventQueue implements IEventQueue {
  private workerUrl(): string {
    // URL is set by Netlify at function runtime, DEPLOY_URL on previews.
    const base =
      process.env.URL ||
      process.env.DEPLOY_URL ||
      `http://localhost:${process.env.PORT || 8888}`;
    return `${base}/.netlify/functions/queue-worker-background`;
  }

  public async publish(queue: QueueName, data: object): Promise<string> {
    const id = `nf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const url = this.workerUrl();
    // We don't await the actual job — background functions return 202
    // immediately. Any HTTP error here surfaces a publish failure (which is
    // worth knowing about).
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queue, data, id }),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(
        `NetlifyEventQueue.publish failed: ${res.status} ${await res.text()}`,
      );
    }
    return id;
  }

  public async publishBatch(queue: QueueName, data: object[]): Promise<object> {
    // No native batching — fan out individual invocations. This is fine for
    // small batches (e.g. sending invites to <100 voters); for large batches
    // we'd want a single background invocation that iterates internally.
    const ids = await Promise.all(data.map((d) => this.publish(queue, d)));
    return ids.map((id) => ({ id }));
  }

  public subscribe(queue: QueueName, handler: EventHandler): void {
    if (HANDLERS.has(queue)) {
      Logger.debug({}, `NetlifyEventQueue: replacing handler for queue=${queue}`);
    }
    HANDLERS.set(queue, handler);
  }

  async debugInfo(): Promise<string> {
    return JSON.stringify({ queues: [...HANDLERS.keys()] });
  }

  async clearStorage(): Promise<void> {
    HANDLERS.clear();
  }
}

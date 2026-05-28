import crypto from 'crypto';
import Logger from '../Services/Logging/Logger';
import ServiceLocator from '../ServiceLocator';
import { C, logCtx } from "../honoTypes";

interface SendGridEvent {
    email?: string;
    event?: string;
    sg_message_id?: string;
    timestamp?: number;
    [key: string]: unknown;
}

const EmailEventsDB = ServiceLocator.emailEventsDb();

function extractBaseMessageId(sg_message_id: string): string {
    // SendGrid appends routing suffixes after the base XMessageID, separated
    // by '.' (e.g. ".filter...", ".recvd-..."). The base ID is base64url and
    // never contains '.', so strip from the first dot.
    const dotIdx = sg_message_id.indexOf('.');
    return dotIdx >= 0 ? sg_message_id.substring(0, dotIdx) : sg_message_id;
}

export const sendGridWebhookController = async (c: C) => {
    const ctx = logCtx(c);
    try {
        const signature = c.req.header('x-twilio-email-event-webhook-signature') ?? 'missing';
        const timestamp = c.req.header('x-twilio-email-event-webhook-timestamp') ?? 'missing';
        Logger.info(ctx, `SendGridWebhook signature=${signature} timestamp=${timestamp}`);

        // Signature verification needs the raw body bytes — go through
        // c.req.raw (the underlying Web Request) instead of c.req.json().
        const rawBody = Buffer.from(await c.req.raw.arrayBuffer());

        let events: SendGridEvent[];
        try {
            events = JSON.parse(rawBody.toString('utf8'));
        } catch {
            Logger.warn(ctx, `SendGridWebhook: could not parse body`);
            return c.text('Bad request', 400);
        }

        Logger.info(ctx, `SendGridWebhook: ${events.length} event(s)`);

        // PUBLIC KEY from SendGrid; safe to have in the repo.
        const verificationKey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5qOZpcaMe4gniCO5t9fSMq0MtkKvVL0qoqUX6Al/sKQK4OLhACy2WJzwYEm6MJm6djEk8GpTkjoTP9hu5ogSOQ==';

        const publicKey = crypto.createPublicKey({
            key: Buffer.from(verificationKey, 'base64'),
            format: 'der',
            type: 'spki',
        });
        const payload = timestamp + rawBody.toString('utf8');
        const valid = crypto.verify('SHA256', Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'));

        if (!valid) {
            Logger.warn(ctx, `SendGridWebhook: invalid signature`);
            return c.text('Invalid signature', 403);
        }

        const timestampAge = Math.abs(Date.now() / 1000 - Number(timestamp));
        if (isNaN(timestampAge) || timestampAge > 86400) {
            Logger.warn(ctx, `SendGridWebhook: timestamp too old or invalid (age=${timestampAge}s)`);
            return c.text('Invalid timestamp', 403);
        }

        for (const event of events) {
            if (!event.sg_message_id || !event.event) continue;
            const message_id = extractBaseMessageId(event.sg_message_id);
            try {
                const sentRow = await EmailEventsDB.getByMessageId(message_id, ctx);
                if (!sentRow) {
                    Logger.warn(ctx, `SendGridWebhook: no sent row for message_id=${message_id} (raw sg_message_id=${event.sg_message_id})`);
                    continue;
                }
                const { email, unique_args, sg_message_id, event: event_type, timestamp: event_ts, ...rest } = event;
                await EmailEventsDB.insert({
                    message_id,
                    election_id: sentRow.election_id,
                    voter_id: sentRow.voter_id,
                    event_type: event_type!,
                    event_timestamp: new Date((event_ts ?? Date.now() / 1000) * 1000).toISOString(),
                    details: Object.keys(rest).length > 0 ? rest : undefined,
                }, ctx);
            } catch (err: any) {
                Logger.error(ctx, `SendGridWebhook: failed to store event for message_id=${message_id}: ${err.message}`);
            }
        }

        return c.text('OK', 200);
    } catch (err: any) {
        Logger.error(ctx, `SendGridWebhook: unexpected error: ${err.message}`);
        return c.text('Internal server error', 500);
    }
};

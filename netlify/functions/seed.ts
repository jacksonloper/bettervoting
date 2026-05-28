// One-shot seed endpoint for dev data.
//
//   GET /.netlify/functions/seed?confirm=seed
//
// Does two things:
//   1. Ensures the dev Identity users exist (idempotent — looks them up,
//      creates only the missing ones). Uses the short-lived admin token
//      Netlify injects at context.clientContext.identity.token, so no
//      admin credentials live in the repo.
//   2. Seeds the dev elections (makeDevElections) owned by the primary dev
//      user, looked up by email so the owner_id is a real Identity UUID.
//
// Identity users are site-global (shared across all deploy contexts), so the
// user step is a no-op after the first run. Netlify DB is per-branch, so the
// election step does real work on each new preview's database.
//
// Guards:
//   - Requires ?confirm=seed so crawlers / link-preview bots hitting the URL
//     don't trigger it.
//   - Refuses if DISALLOW_SEED=true — set that env var on any real production
//     site so this can never seed fake users/elections there.

import './env-shim';
import type { Context } from '@netlify/functions';
import { seedDevElections } from '../../packages/backend/src/DevElections/makeDevElections';

type DevUserSpec = {
    email: string;
    user_metadata: { full_name: string };
    app_metadata?: { roles?: string[] };
    primary?: boolean; // owns the seeded elections
};

const DEV_USERS: DevUserSpec[] = [
    {
        email: 'owner@test.bv',
        user_metadata: { full_name: 'Dev Owner' },
        app_metadata: { roles: ['admin'] },
        primary: true,
    },
    {
        email: 'voter@test.bv',
        user_metadata: { full_name: 'Dev Voter' },
    },
];

type GoTrueUser = { id: string; email: string };

async function listUsers(adminUrl: string, token: string): Promise<GoTrueUser[]> {
    const res = await fetch(`${adminUrl}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`admin list users failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    return body.users ?? [];
}

async function createUser(adminUrl: string, token: string, spec: DevUserSpec, password: string): Promise<GoTrueUser> {
    const res = await fetch(`${adminUrl}/admin/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: spec.email,
            password,
            confirm: true, // mark email as verified without the confirmation email
            user_metadata: spec.user_metadata,
            app_metadata: spec.app_metadata ?? {},
        }),
    });
    if (!res.ok) throw new Error(`admin create user failed for ${spec.email}: ${res.status} ${await res.text()}`);
    return res.json();
}

export default async (req: Request, context: Context) => {
    if (process.env.DISALLOW_SEED === 'true') {
        return Response.json({ error: 'Seeding is disabled on this site (DISALLOW_SEED=true).' }, { status: 403 });
    }
    const url = new URL(req.url);
    if (url.searchParams.get('confirm') !== 'seed') {
        return Response.json({ error: 'Append ?confirm=seed to run.' }, { status: 400 });
    }

    const identity = (context as any).clientContext?.identity as { url: string; token: string } | undefined;
    if (!identity?.token || !identity?.url) {
        return Response.json({
            error: 'No Identity admin token in clientContext. Is Netlify Identity enabled on this site?',
        }, { status: 500 });
    }

    const password = process.env.DEV_USER_PASSWORD;
    if (!password) {
        return Response.json({ error: 'DEV_USER_PASSWORD env var not set (scope=functions).' }, { status: 500 });
    }

    try {
        const existing = await listUsers(identity.url, identity.token);
        const byEmail = new Map(existing.map(u => [u.email.toLowerCase(), u]));

        const users: { email: string; id: string; created: boolean }[] = [];
        let ownerId: string | undefined;

        for (const spec of DEV_USERS) {
            let user = byEmail.get(spec.email.toLowerCase());
            let created = false;
            if (!user) {
                user = await createUser(identity.url, identity.token, spec, password);
                created = true;
            }
            users.push({ email: spec.email, id: user.id, created });
            if (spec.primary) ownerId = user.id;
        }

        const logs: string[] = [];
        const elections = await seedDevElections({
            ownerId,
            force: true,
            log: (m) => { logs.push(m); console.info(m); },
        });

        return Response.json({ ok: true, users, elections, ownerId });
    } catch (err: any) {
        console.error('seed failed:', err?.message ?? err);
        return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
    }
};

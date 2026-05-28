// One-shot seed endpoint for dev data.
//
//   GET /.netlify/functions/seed?confirm=seed
//
// Does two things:
//   1. Ensures the dev Identity users exist (idempotent — looks them up,
//      creates only the missing ones). Uses the `admin` export from
//      @netlify/identity, which obtains the short-lived operator token from
//      the Netlify Functions runtime automatically — no admin credentials in
//      the repo and no reliance on the legacy clientContext injection (which
//      is not populated for Functions 2.0 / `export default` handlers).
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
import { admin, MissingIdentityError } from '@netlify/identity';
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

export default async (req: Request, _context: Context) => {
    if (process.env.DISALLOW_SEED === 'true') {
        return Response.json({ error: 'Seeding is disabled on this site (DISALLOW_SEED=true).' }, { status: 403 });
    }
    const url = new URL(req.url);
    if (url.searchParams.get('confirm') !== 'seed') {
        return Response.json({ error: 'Append ?confirm=seed to run.' }, { status: 400 });
    }

    const password = process.env.DEV_USER_PASSWORD;
    if (!password) {
        return Response.json({ error: 'DEV_USER_PASSWORD env var not set (scope=functions).' }, { status: 500 });
    }

    try {
        // admin.listUsers() returns a normalized User[] and pulls the operator
        // token from the Netlify runtime itself. Bump perPage so a single page
        // covers the handful of dev users without paginating.
        const existing = await admin.listUsers({ perPage: 200 });
        const byEmail = new Map(existing.map(u => [(u.email ?? '').toLowerCase(), u]));

        const users: { email: string; id: string; created: boolean }[] = [];
        let ownerId: string | undefined;

        for (const spec of DEV_USERS) {
            let user = byEmail.get(spec.email.toLowerCase());
            let created = false;
            if (!user) {
                // createUser auto-confirms (no confirmation email). Identity
                // user fields go under `data`: app_metadata / user_metadata.
                user = await admin.createUser({
                    email: spec.email,
                    password,
                    data: {
                        user_metadata: spec.user_metadata,
                        app_metadata: spec.app_metadata ?? {},
                    },
                });
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
        if (err instanceof MissingIdentityError) {
            return Response.json({
                error: 'Netlify Identity is not configured for this runtime. ' +
                    'Confirm Identity is enabled on the site and that this runs on Netlify (or `netlify dev`).',
            }, { status: 500 });
        }
        console.error('seed failed:', err?.message ?? err);
        return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
    }
};

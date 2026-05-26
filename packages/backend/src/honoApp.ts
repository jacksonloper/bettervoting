// Hono app for the Express-free backend.
//
// Outputs:
//   makeApp(): Hono — pass to hono/netlify's `handle` for Netlify Functions 2.0,
//   or to @hono/node-server's `serve` for local dev.
//
// Routes are mounted inline here rather than split across Router files —
// there are only 41 of them and the colocated registration makes the auth /
// middleware chain easy to audit. If this grows past ~75 routes, splitting
// into per-feature sub-apps (`new Hono()` per file, mounted with `app.route`)
// would be the natural next move.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomUUID } from 'crypto';

import Logger from './Services/Logging/Logger';
import type { ILoggingContext } from './Services/Logging/ILogger';
import { logSafeHash } from './Services/Logging/logSafeHash';
import ServiceLocator from './ServiceLocator';
import registerEvents from './Routes/registerEvents';

import { loadElection, electionSpecificAuth, computeUserAuth, returnElection, electionExistsByID } from './Controllers/Election/elections.controllers';
import {
    archiveElection, createElectionController, deleteElection, editElection, editElectionRoles,
    finalizeElection, getElectionResults, getElections, getGlobalElectionStats,
    getSandboxResults, sendInvitationController, sendInvitationsController,
    setOpenState, setPublicResults, sendEmailsController, queryElections,
    claimElection, setWriteInResults,
} from './Controllers/Election';
import { uploadImageController } from './Controllers/uploadImageController';
import {
    castVoteController, uploadBallotsController,
    getBallotsByElectionID, getAnonymizedBallotsByElectionID,
    deleteAllBallotsForElectionID, getBallotByBallotID,
    getWriteInNamesController,
} from './Controllers/Ballot';
import {
    registerVoter, getRollsByElectionID, getByVoterID, addElectionRoll,
    editElectionRoll, approveElectionRoll, flagElectionRoll,
    invalidateElectionRoll, uninvalidateElectionRoll, revealVoterIdByEmail,
} from './Controllers/Roll';
import { sendGridWebhookController } from './Controllers/sendGridWebhookController';
import { getUserToken } from './Controllers/User';
import type { AppEnv } from './honoTypes';

const AccountService = ServiceLocator.accountService();

export default function makeApp() {
    const app = new Hono<AppEnv>();

    // ---- request-id + request/response logging ----
    app.use('*', async (c, next) => {
        const contextId = randomUUID().slice(0, 8);
        const logCtx: ILoggingContext = { contextId, logPrefix: '\n' };
        c.set('logCtx', logCtx);

        const ip =
            c.req.header('x-nf-client-connection-ip') ??
            c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
            '';
        Logger.info(
            { contextId, logPrefix: '\n' },
            `\nREQUEST: ${c.req.method} ${c.req.path} @ ${new Date().toISOString()} ip:${logSafeHash(ip)}`,
        );
        await next();
        Logger.info(logCtx, `RES: ${c.req.method} ${c.req.path}  status:${c.res.status}`);
    });

    // ---- CORS ----
    const allowed = process.env.ALLOWED_URLS?.split(',') ?? ['https://bettervoting.com/'];
    app.use('*', cors({ origin: allowed, credentials: true }));

    // ---- getUser (every /API/* request) ----
    // Reads JWT (clientContext from Netlify Identity, Authorization header,
    // or temp_id cookie) into c.var.user.
    app.use('/API/*', async (c, next) => {
        const cookieHeader = c.req.header('cookie') ?? '';
        const cookies = Object.fromEntries(
            cookieHeader.split(';').map(p => {
                const [k, ...v] = p.trim().split('=');
                return [k, decodeURIComponent(v.join('='))];
            }).filter(([k]) => k),
        );
        const reqLike = {
            headers: (() => { const o: Record<string, string> = {}; c.req.raw.headers.forEach((v, k) => { o[k] = v; }); return o; })(),
            cookies,
            // Netlify Functions 2.0 puts the validated Identity user here.
            clientContext: (c.env as any)?.context?.clientContext ?? null,
        };
        c.set('user', AccountService.extractUserFromRequest(reqLike as any));
        await next();
    });

    // ---- loadElection chain (every /API/Election/:id/*) ----
    // Replaces Express's `router.param('id', ...)` magic: any route with
    // an :id parameter gets the election loaded, election-specific auth
    // applied, and user_auth computed before the handler runs.
    app.use('/API/Election/:id', loadElection, electionSpecificAuth, computeUserAuth);
    app.use('/API/Election/:id/*', loadElection, electionSpecificAuth, computeUserAuth);

    // ---- error handler ----
    app.onError((err: any, c) => {
        const logCtx = c.var.logCtx ?? { contextId: '????????', logPrefix: '\n' };
        Logger.error(logCtx, err?.message ?? String(err));
        const status = err?.httpStatus ?? 500;
        const msg = (err?.detail ?? 'Error') + ` (${logCtx.contextId})`;
        return c.json({ error: msg }, status as any);
    });

    // ---- SendGrid webhook (no body parser — raw body needed for sig verify) ----
    app.post('/API/SendGridWebhook', sendGridWebhookController);

    // ---- legacy token exchange (no-op under BACKEND_PLATFORM=netlify) ----
    app.post('/API/Token', getUserToken);

    // ---- elections routes ----
    app.get('/API/Elections', getElections);
    app.post('/API/Elections', createElectionController);
    app.post('/API/Elections/', createElectionController);
    app.post('/API/QueryElections', queryElections);
    app.get('/API/GlobalElectionStats', getGlobalElectionStats);
    app.post('/API/Sandbox', getSandboxResults);
    app.post('/API/images', uploadImageController);
    app.get('/API/Election/:id', returnElection);
    app.get('/API/Election/:_id/exists', electionExistsByID);
    app.post('/API/Election/:id/claim', claimElection);
    app.delete('/API/Election/:id', deleteElection);
    app.post('/API/Election/:id/edit', editElection);
    app.put('/API/Election/:id/roles', editElectionRoles);
    app.get('/API/ElectionResult/:id', getElectionResults);
    app.post('/API/Election/:id/finalize', finalizeElection);
    app.post('/API/Election/:id/setPublicResults', setPublicResults);
    app.post('/API/Election/:id/archive', archiveElection);
    app.post('/API/Election/:id/setOpenState', setOpenState);
    app.post('/API/Election/:id/sendInvites', sendInvitationsController);
    app.post('/API/Election/:id/sendEmails', sendEmailsController);
    app.post('/API/Election/:id/sendInvite/:voter_id', sendInvitationController);
    app.post('/API/Election/:id/setWriteInResults', setWriteInResults);

    // ---- ballot routes ----
    app.get('/API/Election/:id/ballots', getBallotsByElectionID);
    app.get('/API/Election/:id/anonymizedBallots', getAnonymizedBallotsByElectionID);
    app.delete('/API/Election/:id/ballots', deleteAllBallotsForElectionID);
    app.get('/API/Election/:id/ballot/:ballot_id', getBallotByBallotID);
    app.post('/API/Election/:id/vote', castVoteController);
    app.post('/API/Election/:id/uploadBallots', uploadBallotsController);
    app.get('/API/Election/:id/getWriteIns', getWriteInNamesController);
    app.post('/API/Election/:id/ballot', returnElection);

    // ---- roll routes ----
    app.post('/API/Election/:id/register', registerVoter);
    app.get('/API/Election/:id/rolls', getRollsByElectionID);
    app.get('/API/Election/:id/rolls/:voter_id', getByVoterID);
    app.post('/API/Election/:id/rolls', addElectionRoll);
    app.post('/API/Election/:id/rolls/', addElectionRoll);
    app.put('/API/Election/:id/rolls', editElectionRoll);
    app.put('/API/Election/:id/rolls/', editElectionRoll);
    app.post('/API/Election/:id/rolls/approve', approveElectionRoll);
    app.post('/API/Election/:id/rolls/flag', flagElectionRoll);
    app.post('/API/Election/:id/rolls/invalidate', invalidateElectionRoll);
    app.post('/API/Election/:id/rolls/unflag', uninvalidateElectionRoll);
    app.post('/API/Election/:id/rolls/revealVoterId', revealVoterIdByEmail);

    // ---- debug ----
    app.get('/debug/', (c) => c.text('debug ok'));
    app.get('/debug/test', (c) => c.text('test ok'));

    // Wire event handlers (background queue callbacks). Safe to call multiple
    // times — registerEvents stores handlers in a singleton map.
    registerEvents().catch(err => {
        Logger.error({ contextId: 'app-init' }, `registerEvents failed: ${err?.message ?? err}`);
    });

    return app;
}

// Election context middleware + a couple of lightweight handlers.
//
// In the Express version, the loadElection / electionSpecificAuth /
// computeUserAuth functions were registered as `router.param('id', ...)`
// callbacks that ran before any route with `:id`. In Hono, the equivalent
// is `app.use('/API/Election/:id', ...)` mounted in honoApp.ts.

import { Election, getPrecinctFilteredElection, removeHiddenFields } from '@equal-vote/star-vote-shared/domain_model/Election';
import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import type { ILoggingContext } from '../../Services/Logging/ILogger';
import { roles } from "@equal-vote/star-vote-shared/domain_model/roles";
import { getPermissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { getOrCreateElectionRoll, checkForMissingAuthenticationData, getVoterAuthorization, inputsFromContext } from "../Roll/voterRollUtils";
import { ElectionRoll } from '@equal-vote/star-vote-shared/domain_model/ElectionRoll';
import { sharedConfig } from '@equal-vote/star-vote-shared/config';
import { hashString } from '../controllerUtils';
import { BadRequest } from "@curveball/http-errors";
import { C, cookie, election, logCtx, user, userAuth } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const accountService = ServiceLocator.accountService();
const className = "Elections.Controllers";

// Middleware: GET the Election from the DB and stash it on c.var.election.
// Mounted in honoApp on `/API/Election/:id` and `/API/Election/:id/*`.
export const loadElection = async (c: C, next: () => Promise<void>) => {
    const ctx = logCtx(c);
    const id = c.req.param('id');
    Logger.info(ctx, `${className}.loadElection ${id}`);
    if (!id) { await next(); return; }
    try {
        const e = await ElectionsModel.getElectionByID(id, ctx);
        c.set('election', e);
        await next();
    } catch (err: any) {
        const failMsg = 'Election not found';
        Logger.error(ctx, `${failMsg} electionId=${id}`);
        throw new BadRequest(failMsg);
    }
};

// Middleware: if the election has an auth_key, re-extract the user using that
// election-specific key (lets one election have its own JWT signer).
export const electionSpecificAuth = async (c: C, next: () => Promise<void>) => {
    const e = c.var.election;
    if (!e) { await next(); return; }
    const electionKey = e.auth_key;
    if (electionKey == null || electionKey === "") { await next(); return; }
    const cookieHeader = c.req.header('cookie') ?? '';
    const cookies = Object.fromEntries(
        cookieHeader.split(';').map(p => {
            const [k, ...v] = p.trim().split('=');
            return [k, decodeURIComponent(v.join('='))];
        }).filter(([k]) => k)
    );
    const reqLike = {
        headers: (() => { const o: Record<string, string> = {}; c.req.raw.headers.forEach((v, k) => { o[k] = v; }); return o; })(),
        cookies,
        clientContext: (c.env as any)?.context?.clientContext ?? null,
    };
    const overridden = accountService.extractUserFromRequest(reqLike as any, electionKey);
    c.set('user', overridden);
    await next();
};

// Middleware: tick election state forward if start/end time has elapsed,
// compute user_auth roles + permissions for this user/election pair.
export const computeUserAuth = async (c: C, next: () => Promise<void>) => {
    const ctx = logCtx(c);
    let e = c.var.election;
    if (!e) {
        const id = c.req.param('id');
        const failMsg = "Election not found";
        Logger.info(ctx, `${failMsg} electionId=${id}`);
        throw new BadRequest(failMsg);
    }

    e = await updateElectionStateIfNeeded(ctx, e);
    c.set('election', e);

    const u = user(c);
    const tempIdCookie = cookie(c, 'temp_id');
    const claimKeyCookie = cookie(c, `${e.election_id}_claim_key`);
    const ua = { roles: [] as roles[], permissions: [] as any[] };

    const ownerIsTempUser = e.owner_id.startsWith('v-');
    const hoursSinceCreate = (new Date().getTime() - new Date(e.create_date).getTime()) / (1000 * 60 * 60);
    const tempUserAuth =
        ownerIsTempUser &&
        e.owner_id === tempIdCookie &&
        hoursSinceCreate < sharedConfig.TEMPORARY_ACCESS_HOURS &&
        hashString(claimKeyCookie ?? '') === e.claim_key_hash;

    if (u && e) {
        if ((e.owner_id === u.sub && u.typ !== 'TEMP_ID') || tempUserAuth) {
            ua.roles.push(roles.owner);
        }
        if (e.admin_ids && e.admin_ids.includes(u.email)) {
            ua.roles.push(roles.admin);
        }
        if (e.audit_ids && e.audit_ids.includes(u.email)) {
            ua.roles.push(roles.auditor);
        }
        if (e.credential_ids && e.credential_ids.includes(u.email)) {
            ua.roles.push(roles.credentialer);
        }
    }
    ua.permissions = getPermissions(ua.roles) as any;
    c.set('user_auth', ua);
    Logger.debug(ctx, `done with computeUserAuth...`);
    Logger.debug(ctx, ua);
    await next();
};

async function updateElectionStateIfNeeded(ctx: ILoggingContext, e: Election): Promise<Election> {
    if (e.state === 'draft') return e;

    const currentTime = new Date();
    let stateChange = false;
    let stateChangeMsg = "";

    if (e.state === 'finalized') {
        let openElection = false;
        if (e.start_time) {
            const startTime = new Date(e.start_time);
            if (currentTime.getTime() > startTime.getTime()) openElection = true;
        } else {
            openElection = true;
        }
        if (openElection) {
            stateChange = true;
            stateChangeMsg = `Election ${e.election_id} Transitioning to Open From ${e.state} (start time = ${e.start_time})`;
            e.state = 'open';
        }
    }
    if (e.state === 'open' && e.end_time) {
        const endTime = new Date(e.end_time);
        if (currentTime.getTime() > endTime.getTime()) {
            stateChange = true;
            stateChangeMsg = `Election ${e.election_id} transitioning to Closed From ${e.state} (end time = ${e.end_time})`;
            e.state = 'closed';
        }
    }
    if (stateChange) {
        e = await ElectionsModel.updateElection(e, ctx, stateChangeMsg);
        Logger.info(ctx, stateChangeMsg);
    }
    return e;
}

export const electionExistsByID = async (c: C) => {
    // The original route used `:_id` (not `:id`) so router.param('id', ...)
    // wouldn't fire — we don't need the election to be loaded for this one.
    const id = c.req.param('_id') ?? c.req.param('id');
    Logger.info(logCtx(c), `${className}.getElectionExistsByID ${id}`);
    return c.json({ exists: await ElectionsModel.electionExistsByID(id!, logCtx(c)) });
};

export const returnElection = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    Logger.info(ctx, `${className}.returnElection ${e.election_id}`);

    const inputs = inputsFromContext(c);
    const missingAuthData = checkForMissingAuthenticationData(inputs, e);
    let roll: ElectionRoll | null = null;
    if (missingAuthData === null) {
        roll = await getOrCreateElectionRoll(inputs, e);
    }
    const voterAuthorization = getVoterAuthorization(roll, missingAuthData);
    removeHiddenFields(e);

    const ua = userAuth(c);
    return c.json({
        election: e,
        precinctFilteredElection: getPrecinctFilteredElection(e, roll),
        voterAuth: {
            authorized_voter: voterAuthorization.authorized_voter,
            has_voted: voterAuthorization.has_voted,
            required: voterAuthorization.required,
            roles: ua.roles,
            permissions: ua.permissions,
        },
    });
};

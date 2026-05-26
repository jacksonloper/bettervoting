// Hono-native auth middleware.
//
// Previously these were Express middleware exported as `(req, res, next)`
// functions. The Hono equivalents take `(c, next)` and read/write through
// c.var.* instead of mutating req. getUser is registered globally in
// honoApp.ts; isLoggedIn / hasPermission / assertOwnership are used to gate
// individual routes that need stronger checks.

import Logger from "../../Services/Logging/Logger";
import { Unauthorized } from "@curveball/http-errors";
import { permission } from "@equal-vote/star-vote-shared/domain_model/permissions";
import { roles } from "@equal-vote/star-vote-shared/domain_model/roles";
import ServiceLocator from "../../ServiceLocator";
import { C, election, logCtx, user, userAuth } from "../../honoTypes";

const className = 'Auth.Controllers';
const accountService = ServiceLocator.accountService();

// Reads JWT / clientContext / temp_id cookie and sets c.var.user. Mounted
// globally on /API/* in honoApp.ts; the legacy file kept the export here so
// any external callers (event handlers) still resolve.
export const getUser = async (c: C, next: () => Promise<void>) => {
    const ctx = logCtx(c);
    Logger.info(ctx, `${className}.getUser`);

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
        clientContext: (c.env as any)?.context?.clientContext ?? null,
    };
    const u = accountService.extractUserFromRequest(reqLike as any);
    if (u) c.set('user', u);
    await next();
};

export const isLoggedIn = async (c: C, next: () => Promise<void>) => {
    const ctx = logCtx(c);
    const u = user(c);
    Logger.info(ctx, `${className}.isLoggedIn user=${!!u}`);
    if (!u) {
        Logger.info(ctx, "Not Logged In");
        throw new Unauthorized("Not Logged In");
    }
    await next();
};

export const hasPermission = (perm: permission) => async (c: C, next: () => Promise<void>) => {
    const ctx = logCtx(c);
    const ua = userAuth(c);
    Logger.debug(ctx, "\n= = = = =\n!!! hasPermission with: " + JSON.stringify(ua));
    if (!ua.roles.some((role: roles) => perm.includes(role))) {
        const msg = "Does not have permission";
        Logger.info(ctx, msg);
        throw new Unauthorized(msg);
    }
    await next();
};

export const assertOwnership = async (c: C, next: () => Promise<void>) => {
    const ctx = logCtx(c);
    const e = election(c);
    const u = user(c);
    Logger.info(ctx, `${className}.assertOwnership`);
    Logger.debug(ctx, `${e.owner_id} ==? ${u.sub}`);
    if (e.owner_id !== u.sub) {
        const msg = "Unauthorized: User does not own electon";
        Logger.info(ctx, msg);
        throw new Unauthorized(msg);
    }
    await next();
};

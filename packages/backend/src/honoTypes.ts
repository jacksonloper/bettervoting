// Type and helper layer for the Hono port.
//
// Every controller takes a single `C` (Hono Context) parameter and returns a
// Response. The Variables type captures the per-request data that middleware
// attaches and controllers consume — analogous to the fields we used to mutate
// onto Express's `req`.

import type { Context } from 'hono';
import type { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import type { roles } from '@equal-vote/star-vote-shared/domain_model/roles';
import type { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import type { ILoggingContext } from './Services/Logging/ILogger';
import { getCookie } from 'hono/cookie';

type p = keyof typeof permissions;

export type UserAuth = { roles: roles[]; permissions: p[] };

export type AppVariables = {
    logCtx: ILoggingContext;          // pass to Logger.* and Model fns
    user: any | null;                  // normalized identity (or null)
    election?: Election | null;        // set by loadElection middleware for /Election/:id
    user_auth?: UserAuth;              // set by computeUserAuth middleware
    authorized_voter?: boolean;
    has_voted?: boolean;
};

export type AppEnv = { Variables: AppVariables };
export type C = Context<AppEnv>;

// Body cache: Hono lets you read req.json() exactly once. We cache so multiple
// callers within a request can read the body.
export async function body<T = any>(c: C): Promise<T> {
    const stash = c as any;
    if (stash.__cachedBody !== undefined) return stash.__cachedBody;
    try {
        stash.__cachedBody = await c.req.json();
    } catch {
        stash.__cachedBody = {} as T;
    }
    return stash.__cachedBody;
}

export function cookie(c: C, name: string): string | undefined {
    return getCookie(c, name);
}

// Convenience getters so controllers don't have to read c.var.* everywhere.
export const user = (c: C) => c.var.user;
export const userAuth = (c: C) => c.var.user_auth!;
export const election = (c: C) => c.var.election as import('@equal-vote/star-vote-shared/domain_model/Election').Election;
export const logCtx = (c: C) => c.var.logCtx;

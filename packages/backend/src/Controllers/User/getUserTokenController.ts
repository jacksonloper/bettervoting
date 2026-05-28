import ServiceLocator from "../../ServiceLocator";
import { C, logCtx } from "../../honoTypes";

const AccountService = ServiceLocator.accountService();

export const getUserToken = async (c: C) => {
    // Under BACKEND_PLATFORM=netlify the frontend uses the Netlify Identity
    // widget directly with /.netlify/identity/token; this endpoint exists as
    // a friendly 410 hint instead of 404'ing.
    if (process.env.BACKEND_PLATFORM === 'netlify') {
        return c.json({
            error: 'Gone',
            message: 'Token exchange is handled by the Netlify Identity widget. POST your credentials to /.netlify/identity/token directly.',
        }, 410);
    }
    // Legacy Keycloak path — AccountService.getToken read req.query.code etc.
    // Build a minimal shim so the old code keeps working in local dev.
    const url = new URL(c.req.url);
    const reqLike = {
        query: Object.fromEntries(url.searchParams),
        contextId: logCtx(c).contextId,
    };
    const data = await AccountService.getToken(reqLike as any);
    return c.json(data);
};

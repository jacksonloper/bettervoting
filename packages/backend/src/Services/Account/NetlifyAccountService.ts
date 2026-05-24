// Netlify Identity replacement for AccountService.
//
// In production on Netlify:
//   1. The frontend uses the Netlify Identity widget (gotrue-js) to log in.
//   2. The widget stores the JWT in localStorage and sends it as
//      `Authorization: Bearer <jwt>` on every API call.
//   3. Netlify's edge invokes the api function and populates
//      `context.clientContext.user` from a valid JWT. The api wrapper
//      (netlify/functions/api.ts) attaches that context to `req.clientContext`.
//
// This service maps the Identity user object to the same shape the rest of
// the codebase expects (the Keycloak-shaped { sub, email, ... }).

import Logger from '../Logging/Logger';
import { IRequest } from '../../IRequest';
import { InternalServerError } from '@curveball/http-errors';
const jwt = require('jsonwebtoken');

// Shape produced by Netlify Identity / GoTrue.
type NetlifyIdentityUser = {
  sub?: string;
  id?: string;
  email?: string;
  email_verified?: boolean;
  app_metadata?: { roles?: string[]; provider?: string };
  user_metadata?: Record<string, any>;
  exp?: number;
  iss?: string;
  aud?: string;
};

export default class NetlifyAccountService {
  // Kept for interface parity with the Keycloak AccountService — the frontend
  // no longer calls /API/Token under Netlify Identity, but we expose a useful
  // error rather than 404ing if someone hits it.
  authConfig = {
    clientId: 'netlify-identity',
    responseType: 'code',
    endpoints: {
      login: '/.netlify/identity',
      logout: '/.netlify/identity/logout',
      token: '/.netlify/identity/token',
      authorize: '/.netlify/identity/authorize',
      userinfo: '/.netlify/identity/user',
    },
  };

  getToken = async (_req: any) => {
    throw new InternalServerError(
      'Token exchange is handled client-side by the Netlify Identity widget; ' +
        '/API/Token is not used under BACKEND_PLATFORM=netlify.'
    );
  };

  extractUserFromRequest = (req: IRequest, _customKey?: string) => {
    // Path 1 (preferred): Netlify already validated the JWT and attached the
    // user to clientContext. No verification needed on our side.
    const clientContext = (req as any).clientContext;
    if (clientContext?.user) {
      return this.normalize(clientContext.user as NetlifyIdentityUser);
    }

    // Path 2: Authorization header. Useful for `netlify dev` and as a backup
    // when the function is invoked outside the Netlify proxy. We verify the
    // signature if JWT_SECRET is set, otherwise we decode-only and rely on
    // the Identity widget having gated the call.
    const auth =
      (req.headers?.authorization as string | undefined) ||
      (req.headers?.Authorization as string | undefined);
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      const decoded = this.verifyOrDecode(token, req);
      if (decoded) return this.normalize(decoded);
    }

    // Path 3: temp_id cookie (anonymous voter). Kept from the Keycloak flow
    // so unauthenticated ballot submissions still work for elections that
    // allow them.
    const tempId = req.cookies?.temp_id;
    if (tempId) {
      return { typ: 'TEMP_ID', sub: tempId };
    }

    return null;
  };

  private verifyOrDecode(token: string, req: any): NetlifyIdentityUser | null {
    const secret = process.env.JWT_SECRET || process.env.GOTRUE_JWT_SECRET;
    try {
      if (secret) return jwt.verify(token, secret);
      return jwt.decode(token);
    } catch (e: any) {
      Logger.warn(req, 'Netlify Identity JWT verify failed: ', e.message);
      return null;
    }
  }

  private normalize(u: NetlifyIdentityUser) {
    return {
      typ: 'ID',
      sub: u.sub || u.id,
      email: u.email,
      email_verified: u.email_verified,
      // Keep the original under both names so route-level checks that read
      // either `req.user.roles` or `req.user.app_metadata.roles` keep working.
      roles: u.app_metadata?.roles ?? [],
      app_metadata: u.app_metadata,
      user_metadata: u.user_metadata,
    };
  }
}

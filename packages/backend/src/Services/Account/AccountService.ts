import Logger from '../Logging/Logger';
import axios from 'axios';
import qs from 'qs';
import 'dotenv/config';
import { InternalServerError } from "@curveball/http-errors";
import AccountServiceUtils from './AccountServiceUtils';

// AccountService is the Keycloak-backed account path used by the legacy
// non-Netlify deploy. extractUserFromRequest accepts a structural req-like
// object (headers/cookies) so it works with both Express-shaped requests
// and the Hono adapter shim built in honoApp.ts.
export type ReqLike = {
    headers?: Record<string, any>;
    cookies?: Record<string, string | undefined>;
    query?: Record<string, string | undefined>;
};

export default class AccountService {
    authConfig;
    private privateKey: string;
    private publicKey: string;

    constructor() {
        const keycloakAuthConfig = {
            clientId: 'web',
            responseType: 'code',
            endpoints: {
                login: `${process.env.KEYCLOAK_URL}/auth`,
                logout: `${process.env.KEYCLOAK_URL}/logout`,
                token: `${process.env.KEYCLOAK_URL}/token`,
                authorize: `${process.env.KEYCLOAK_URL}/auth`,
                userinfo: `${process.env.KEYCLOAK_URL}/userinfo`,
            },
        };
        this.authConfig = keycloakAuthConfig;
        if (!process.env.KEYCLOAK_SECRET) {
            throw new Error("AccountService missing process.env.KEYCLOAK_SECRET");
        } else {
            this.privateKey = process.env.KEYCLOAK_SECRET;
        }

        const formatPublicKey = (key: string) => [
            '-----BEGIN PUBLIC KEY-----',
            key,
            '-----END PUBLIC KEY-----',
        ].join('\n');

        if (process.env.KEYCLOAK_PUBLIC_KEY) {
            this.publicKey = formatPublicKey(process.env.KEYCLOAK_PUBLIC_KEY);
        } else {
            this.publicKey = '(pending request)';
            fetch((process.env.KEYCLOAK_URL as string).split('/protocol')[0])
                .then(res => res.json())
                .then(obj => this.publicKey = formatPublicKey(obj.public_key));
        }
    }

    getToken = async (req: ReqLike & { query: Record<string, string | undefined>; cookies?: Record<string, string | undefined> }) => {
        const params: any = {
            grant_type: req.query.grant_type,
            client_id: this.authConfig.clientId,
            redirect_uri: req.query.redirect_uri,
        };

        if ('code' in req.query) {
            params.code = req.query.code;
        } else {
            params.refresh_token = req.cookies?.refresh_token;
        }

        if (process.env.KEYCLOAK_SECRET === '<insert secret>') {
            throw new InternalServerError('\n\n\nKEYCLOAK_SECRET from the .env is still set to <insert secret>, please complete the "Configuring Keycloak" steps at https://docs.bettervoting.com/contributions/1_local_setup.html\n\n\n');
        }
        if (process.env.KEYCLOAK_PUBLIC_KEY === '<insert public key>') {
            throw new InternalServerError('\n\n\nKEYCLOAK_PUBLIC_KEY from the .env is still set to <insert public key>, please complete the "Configuring Keycloak" steps at https://docs.bettervoting.com/contributions/1_local_setup.html\n\n\n');
        }

        try {
            const response = await axios.post(
                this.authConfig.endpoints.token,
                qs.stringify(params),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${Buffer.from(`${this.authConfig.clientId}:${process.env.KEYCLOAK_SECRET}`).toString('base64')}`,
                    },
                },
            );
            return response.data;
        } catch (err: any) {
            Logger.error(undefined, 'Error while requesting a token', err.response?.data);
            throw new InternalServerError("Error requesting token");
        }
    };

    extractUserFromRequest = (req: ReqLike, customKey?: string) => {
        const cookies = req.cookies ?? {};
        const token = customKey ? cookies.custom_id_token : cookies.id_token;
        if (token) {
            const key = customKey ? customKey : this.publicKey;
            return AccountServiceUtils.extractUserFromRequest(req as any, token, key);
        }
        const tempId = cookies.temp_id;
        if (tempId) {
            return { typ: 'TEMP_ID', sub: tempId };
        }
        return null;
    };
}

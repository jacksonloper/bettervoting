import {
    createContext,
    useContext,
    useEffect,
    useState,
} from 'react';
import type * as NetlifyIdentity from 'netlify-identity-widget';

type NetlifyUser = NetlifyIdentity.User;
// gotrue-js attaches .jwt() to the User at runtime; the published widget types
// omit it, so we narrow here rather than littering casts at call sites.
type UserWithJwt = NetlifyUser & { jwt: (forceRefresh?: boolean) => Promise<string> };

// Widget is loaded via <script> tag in index.html (per Netlify's docs) — it
// attaches itself to window.netlifyIdentity. Going through the script tag
// avoids rspack's strict-ESM rejection of the UMD npm bundle.
declare global {
    interface Window {
        netlifyIdentity?: typeof NetlifyIdentity;
    }
}
const netlifyIdentity = typeof window !== 'undefined' ? window.netlifyIdentity : undefined;

// Set NETLIFY_IDENTITY_URL only when the app is served from a different origin
// than the Identity endpoint. Normal Netlify deploys auto-detect from window.location.
const apiUrl = process.env.REACT_APP_NETLIFY_IDENTITY_URL;
netlifyIdentity?.init(apiUrl ? { APIUrl: apiUrl } : undefined);

export interface IAuthSession {
    isLoggedIn: () => boolean
    openLogin: () => void
    openLogout: () => void
    openAccount: () => void
    getIdField: (fieldName: string) => string | null
    getToken: () => Promise<string | null>
}

const AuthSessionContext = createContext<IAuthSession>(null);

export function AuthSessionContextProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<NetlifyUser | null>(netlifyIdentity?.currentUser() ?? null);

    useEffect(() => {
        if (!netlifyIdentity) return;
        const onLogin = (u: NetlifyUser) => {
            setUser(u);
            netlifyIdentity.close();
        };
        const onLogout = () => setUser(null);
        const onInit = (u: NetlifyUser | null) => setUser(u);

        netlifyIdentity.on('login', onLogin);
        netlifyIdentity.on('logout', onLogout);
        netlifyIdentity.on('init', onInit);
        return () => {
            netlifyIdentity.off('login', onLogin);
            netlifyIdentity.off('logout', onLogout);
            netlifyIdentity.off('init', onInit);
        };
    }, []);

    const isLoggedIn = () => user !== null;
    const openLogin = () => netlifyIdentity?.open('login');
    const openLogout = () => { netlifyIdentity?.logout(); };
    const openAccount = () => netlifyIdentity?.open();

    const getIdField = (fieldName: string) => {
        if (!user) return null;
        // Map the legacy Keycloak field names that the rest of the app reads.
        switch (fieldName) {
            case 'sub':
                return user.id;
            case 'email':
                return user.email;
            case 'given_name': {
                const fullName = user.user_metadata?.full_name;
                return fullName ? fullName.split(' ')[0] : (user.email ?? null);
            }
            default: {
                const meta = user.user_metadata as Record<string, unknown> | null;
                const v = meta?.[fieldName];
                return typeof v === 'string' ? v : null;
            }
        }
    };

    const getToken = async (): Promise<string | null> => {
        const current = netlifyIdentity?.currentUser() as UserWithJwt | null;
        if (!current) return null;
        return current.jwt();
    };

    return (
        <AuthSessionContext.Provider
            value={{
                isLoggedIn,
                openLogin,
                openLogout,
                openAccount,
                getIdField,
                getToken,
            }}>
            {children}
        </AuthSessionContext.Provider>
    );
}

export default function useAuthSession() {
    return useContext(AuthSessionContext);
}

import {
    createContext,
    useContext,
    useEffect,
    useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getUser,
    logout as identityLogout,
    onAuthChange,
    refreshSession,
    handleAuthCallback,
    type User,
} from '@netlify/identity';

// Headless Netlify Identity. The widget (iframe modal) is gone; auth UI lives
// in our own pages (/login, /reset-password, /account) so the browser's
// password manager works and the email-callback hashes are handled explicitly.
// The package auto-detects the Identity endpoint from window.location.origin,
// so no init() / config is needed on a normal Netlify deploy.

export interface IAuthSession {
    isLoggedIn: () => boolean
    openLogin: () => void
    openLogout: () => void
    openAccount: () => void
    getIdField: (fieldName: string) => string | null
    getToken: () => Promise<string | null>
}

const AuthSessionContext = createContext<IAuthSession>(null);

function readCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

export function AuthSessionContextProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        let cancelled = false;

        (async () => {
            // Consume any auth-callback hash (#recovery_token / #confirmation_token
            // / #invite_token / OAuth redirect) that an Identity email appended.
            try {
                const result = await handleAuthCallback();
                if (result?.type === 'recovery') {
                    // Logged in, but must choose a new password before doing anything.
                    navigate('/reset-password', { replace: true });
                } else if (result?.type === 'invite' && result.token) {
                    navigate(`/login?invite=${encodeURIComponent(result.token)}`, { replace: true });
                }
            } catch {
                // Invalid/expired token — fall through and render the normal page.
            }
            const u = await getUser();
            if (!cancelled) setUser(u);
        })();

        const unsubscribe = onAuthChange((_event, u) => setUser(u));
        return () => { cancelled = true; unsubscribe(); };
        // navigate is stable across renders; run this once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isLoggedIn = () => user !== null;
    const openLogin = () => navigate('/login');
    const openLogout = async () => {
        try { await identityLogout(); } finally { setUser(null); navigate('/'); }
    };
    const openAccount = () => navigate('/account');

    const getIdField = (fieldName: string): string | null => {
        if (!user) return null;
        // Map the legacy Keycloak field names the rest of the app still reads.
        switch (fieldName) {
            case 'sub':
                return user.id;
            case 'email':
                return user.email ?? null;
            case 'given_name':
                return user.name ? user.name.split(' ')[0] : (user.email ?? null);
            default: {
                const v = user.userMetadata?.[fieldName];
                return typeof v === 'string' ? v : null;
            }
        }
    };

    const getToken = async (): Promise<string | null> => {
        // refreshSession returns a fresh JWT when it refreshes a near-expiry token
        // (and rewrites the nf_jwt cookie); it returns null when the current token
        // is still valid, in which case we read that token straight off the cookie.
        const refreshed = await refreshSession().catch(() => null);
        return refreshed ?? readCookie('nf_jwt');
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

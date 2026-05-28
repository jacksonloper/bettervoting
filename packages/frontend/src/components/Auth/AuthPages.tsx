import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, TextField, Typography, Alert, Link as MuiLink } from '@mui/material';
import {
    login,
    signup,
    acceptInvite,
    requestPasswordRecovery,
    updateUser,
    AuthError,
} from '@netlify/identity';
import { PrimaryButton } from '../styles';
import useAuthSession from '../AuthSessionContextProvider';

// Headless Netlify Identity auth screens. These are ordinary DOM <form>s (not
// the old widget iframe), so the browser's password manager — save, autofill,
// and "suggest strong password" — works normally.

const errMsg = (e: unknown): string =>
    e instanceof AuthError ? e.message : (e instanceof Error ? e.message : 'Something went wrong.');

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Box sx={{ maxWidth: 420, mx: 'auto', mt: 8, mb: 8, px: 3 }}>
            <Typography variant="h4" sx={{ mb: 3, textAlign: 'center', fontWeight: 'bold' }}>
                {title}
            </Typography>
            {children}
        </Box>
    );
}

export function LoginPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const inviteToken = params.get('invite');
    const [mode, setMode] = useState<'login' | 'signup'>(inviteToken ? 'signup' : 'login');
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true); setError(null); setNotice(null);
        try {
            if (inviteToken) {
                await acceptInvite(inviteToken, password);
                navigate('/manage');
            } else if (mode === 'signup') {
                const user = await signup(email, password, { full_name: fullName });
                // If the Identity instance auto-confirms, signup logs the user in
                // and getUser() will see them; otherwise they must confirm by email.
                if (user) navigate('/manage');
                else setNotice('Check your email to confirm your account, then sign in.');
            } else {
                await login(email, password);
                navigate('/manage');
            }
        } catch (e) {
            setError(errMsg(e));
        } finally {
            setBusy(false);
        }
    };

    const signingUp = mode === 'signup' || !!inviteToken;

    return (
        <AuthCard title={inviteToken ? 'Accept invitation' : (signingUp ? 'Create account' : 'Sign in')}>
            <form onSubmit={submit}>
                <Box display="flex" flexDirection="column" gap={2}>
                    {error && <Alert severity="error">{error}</Alert>}
                    {notice && <Alert severity="success">{notice}</Alert>}
                    {signingUp && (
                        <TextField
                            label="Full name" value={fullName} onChange={e => setFullName(e.target.value)}
                            autoComplete="name" fullWidth
                        />
                    )}
                    {!inviteToken && (
                        <TextField
                            label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                            autoComplete="email" required fullWidth
                        />
                    )}
                    <TextField
                        label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                        autoComplete={signingUp ? 'new-password' : 'current-password'} required fullWidth
                    />
                    <PrimaryButton type="submit" disabled={busy} fullWidth>
                        {busy ? 'Please wait…' : (inviteToken ? 'Accept invitation' : (signingUp ? 'Create account' : 'Sign in'))}
                    </PrimaryButton>
                </Box>
            </form>
            {!inviteToken && (
                <Box display="flex" justifyContent="space-between" sx={{ mt: 2 }}>
                    <MuiLink component="button" type="button" underline="hover"
                        onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setNotice(null); }}>
                        {mode === 'login' ? 'Create an account' : 'Have an account? Sign in'}
                    </MuiLink>
                    <MuiLink component="button" type="button" underline="hover" onClick={() => navigate('/forgot-password')}>
                        Forgot password?
                    </MuiLink>
                </Box>
            )}
        </AuthCard>
    );
}

export function RequestResetPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try {
            await requestPasswordRecovery(email);
            setSent(true);
        } catch (e) {
            setError(errMsg(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthCard title="Reset your password">
            {sent ? (
                <Alert severity="success">
                    If an account exists for {email}, a reset link is on its way. Open it on this device to set a new password.
                </Alert>
            ) : (
                <form onSubmit={submit}>
                    <Box display="flex" flexDirection="column" gap={2}>
                        {error && <Alert severity="error">{error}</Alert>}
                        <TextField
                            label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                            autoComplete="email" required fullWidth
                        />
                        <PrimaryButton type="submit" disabled={busy} fullWidth>
                            {busy ? 'Sending…' : 'Send reset link'}
                        </PrimaryButton>
                    </Box>
                </form>
            )}
            <Box sx={{ mt: 2, textAlign: 'center' }}>
                <MuiLink component="button" type="button" underline="hover" onClick={() => navigate('/login')}>
                    Back to sign in
                </MuiLink>
            </Box>
        </AuthCard>
    );
}

// Target of the #recovery_token email link. AuthSessionContextProvider runs
// handleAuthCallback() on mount, which logs the user in (recovery state) and
// redirects here so they can choose a new password.
export function ResetPasswordPage() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) { setError('Passwords do not match.'); return; }
        setBusy(true); setError(null);
        try {
            await updateUser({ password });
            navigate('/manage');
        } catch (e) {
            setError(errMsg(e) + ' Your reset link may have expired — request a new one.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthCard title="Choose a new password">
            <form onSubmit={submit}>
                <Box display="flex" flexDirection="column" gap={2}>
                    {error && <Alert severity="error">{error}</Alert>}
                    {/* a hidden username field helps password managers associate the credential */}
                    <input type="text" name="username" autoComplete="username" hidden readOnly value="" />
                    <TextField
                        label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                        autoComplete="new-password" required fullWidth
                    />
                    <TextField
                        label="Confirm new password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                        autoComplete="new-password" required fullWidth
                    />
                    <PrimaryButton type="submit" disabled={busy} fullWidth>
                        {busy ? 'Saving…' : 'Save new password'}
                    </PrimaryButton>
                </Box>
            </form>
            <Box sx={{ mt: 2, textAlign: 'center' }}>
                <MuiLink component="button" type="button" underline="hover" onClick={() => navigate('/forgot-password')}>
                    Request a new reset link
                </MuiLink>
            </Box>
        </AuthCard>
    );
}

export function AccountPage() {
    const authSession = useAuthSession();
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    if (!authSession.isLoggedIn()) {
        return (
            <AuthCard title="Account">
                <Alert severity="info">
                    You are not signed in.{' '}
                    <MuiLink component="button" type="button" underline="hover" onClick={() => navigate('/login')}>
                        Sign in
                    </MuiLink>
                </Alert>
            </AuthCard>
        );
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true); setError(null); setDone(false);
        try {
            await updateUser({ password });
            setPassword('');
            setDone(true);
        } catch (e) {
            setError(errMsg(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthCard title="Account">
            <Typography sx={{ mb: 2 }}>
                Signed in as <strong>{authSession.getIdField('email')}</strong>
            </Typography>
            <form onSubmit={submit}>
                <Box display="flex" flexDirection="column" gap={2}>
                    {error && <Alert severity="error">{error}</Alert>}
                    {done && <Alert severity="success">Password updated.</Alert>}
                    <input type="text" name="username" autoComplete="username" hidden readOnly
                        value={authSession.getIdField('email') ?? ''} />
                    <TextField
                        label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                        autoComplete="new-password" required fullWidth
                    />
                    <PrimaryButton type="submit" disabled={busy} fullWidth>
                        {busy ? 'Saving…' : 'Change password'}
                    </PrimaryButton>
                </Box>
            </form>
            <Box sx={{ mt: 3, textAlign: 'center' }}>
                <MuiLink component="button" type="button" underline="hover" onClick={() => authSession.openLogout()}>
                    Sign out
                </MuiLink>
            </Box>
        </AuthCard>
    );
}

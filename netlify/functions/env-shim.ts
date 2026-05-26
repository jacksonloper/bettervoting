// Runtime env assertions for Netlify functions.
//
// Netlify's [build.environment] in netlify.toml is build-time only and does
// NOT reach functions at runtime. For non-secret deploy-target switches we
// don't want a UI knob — the repo entrypoint asserts the platform here.
// Import this BEFORE any backend module so ServiceLocator sees the right
// value when it captures IS_NETLIFY at module load.
process.env.BACKEND_PLATFORM ??= 'netlify';

// Bridge for @netlify/database@1.x: it reads NETLIFY_DB_URL, but Netlify
// itself (and our migration scripts) use NETLIFY_DATABASE_URL. Map any
// available name into NETLIFY_DB_URL so getDatabase() succeeds.
process.env.NETLIFY_DB_URL ??=
    process.env.NETLIFY_DATABASE_URL ??
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL;

// Diagnostics: print what we ended up with (redacted) plus any Netlify/DB-ish
// env keys present, so we can see if Netlify is auto-injecting under some
// other name. Names only for the env-key list — never values.
const netlifyKeys = Object.keys(process.env)
    .filter((k) => /^(NETLIFY|DB|DATABASE|NEON|PG)/i.test(k))
    .sort();
const redact = (url: string | undefined) => {
    if (!url) return '(unset)';
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.username ? '***@' : ''}${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
    } catch {
        // Couldn't parse — show length and first/last chars so we can see if
        // it's a placeholder like "base" or a templating bug.
        return `(unparseable len=${url.length} preview=${JSON.stringify(url.slice(0, 8))}…${JSON.stringify(url.slice(-8))})`;
    }
};
// eslint-disable-next-line no-console
console.warn(
    '[env-shim] NETLIFY_DB_URL=' +
        redact(process.env.NETLIFY_DB_URL) +
        ' PGHOST=' +
        (process.env.PGHOST ?? '(unset)') +
        ' netlify/db-ish keys=' +
        JSON.stringify(netlifyKeys)
);

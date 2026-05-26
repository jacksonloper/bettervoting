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

// If we still don't have one, log which Netlify-ish env vars ARE set so we
// can diagnose without another deploy. (Names only — never values.)
if (!process.env.NETLIFY_DB_URL) {
    const netlifyKeys = Object.keys(process.env)
        .filter((k) => /^(NETLIFY|DB|DATABASE|NEON|PG)/i.test(k))
        .sort();
    // eslint-disable-next-line no-console
    console.warn(
        '[env-shim] No DB URL found. NETLIFY_DB_URL/NETLIFY_DATABASE_URL/' +
            'NETLIFY_DATABASE_URL_UNPOOLED/DATABASE_URL are all unset. ' +
            'Netlify-ish env keys present at function runtime: ' +
            JSON.stringify(netlifyKeys)
    );
}

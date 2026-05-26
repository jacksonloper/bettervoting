// Runtime env assertions for Netlify functions.
//
// Netlify's [build.environment] in netlify.toml is build-time only and does
// NOT reach functions at runtime. For non-secret deploy-target switches we
// don't want a UI knob — the repo entrypoint asserts the platform here.
// Import this BEFORE any backend module so ServiceLocator sees the right
// value when it captures IS_NETLIFY at module load.
process.env.BACKEND_PLATFORM ??= 'netlify';

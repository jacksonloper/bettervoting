import { createHmac, randomBytes } from "crypto";

// Secret used to derive the weekly hashing key.
//
// Precedence:
//   1. LOG_HASH_SECRET env var (recommended on Netlify and any multi-instance
//      deploy — without it, every function cold start gets its own salt and
//      cross-instance correlation breaks). Set as a Netlify secret and rotate
//      periodically. Use any high-entropy value (e.g. `openssl rand -hex 32`).
//   2. randomBytes(32) — fallback for local dev only. Stable within a single
//      process, lost on restart, never leaves memory.
//
// The weekly bucket below still rotates the effective hashing key on top of
// whatever cadence you rotate LOG_HASH_SECRET, so even with a stable secret
// hashes for a given input change every ~7 days.
function loadSecret(): Buffer {
    const envSecret = process.env.LOG_HASH_SECRET;
    if (envSecret && envSecret.length >= 16) {
        return Buffer.from(envSecret, "utf8");
    }
    if (process.env.BACKEND_PLATFORM === "netlify") {
        // One-line warning so this is loud in the function logs — without a
        // shared secret, log-correlation across cold starts is impossible.
        console.warn(
            "logSafeHash: LOG_HASH_SECRET is not set; falling back to per-process random salt. " +
            "Cross-instance correlation will not work on Netlify Functions.",
        );
    }
    return randomBytes(32);
}

const secret = loadSecret();

function getWeeklyKey(): Buffer {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weekIndex = Math.floor(Date.now() / msPerWeek);
    return createHmac("sha256", secret).update(String(weekIndex)).digest();
}

/**
 * HMAC PII for log output. Produces a short, consistent hash that allows
 * correlating repeated events from the same identity across all function
 * instances within the same ~7-day window, without exposing the raw value.
 */
export function logSafeHash(value: string | undefined | null): string {
    if (!value) return "[empty]";
    const key = getWeeklyKey();
    const hash = createHmac("sha256", key).update(value).digest("hex").slice(0, 12);
    return `[h:${hash}]`;
}

// ──────────────────────────────────────────────────────────
// IP-based sliding-window rate limit for public routes that burn paid
// upstream credits (Gemini, Odds API). In-memory only — one Vercel serverless
// instance keeps its own bucket, so a distributed attacker can multiply the
// budget by however many warm containers you have. For our threat model
// (drive-by curl loops, not coordinated botnets) that's the right cost/value.
//
// Use for endpoints that:
//   - can't require auth (public UI features), AND
//   - hit a paid upstream, AND
//   - have no natural cache key that would deduplicate the abuse
// ──────────────────────────────────────────────────────────

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
// Bounded LRU-ish — if the map grows past this, we drop the oldest keys.
// Nothing scientific about the number; it's "large enough that legitimate
// traffic won't evict, small enough that memory is bounded on a runaway."
const MAX_KEYS = 5000;

function ipFrom(req: Request): string {
  // Vercel proxies the real client IP in x-forwarded-for. First value in the
  // comma-separated chain is the client; subsequent are intermediate proxies.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in the current window. 0 when blocked. */
  remaining: number;
  /** Milliseconds until the oldest request in the window ages out. */
  retryAfterMs: number;
}

/**
 * Sliding-window: at most `limit` requests per `windowMs` per IP.
 *
 * Not perfect — a determined attacker with a proxy pool defeats it — but
 * closes the "single-script hammer" hole that's currently open on
 * game-summary-ai and scan-slip.
 */
export function checkIpRateLimit(
  req: Request,
  opts: { limit: number; windowMs: number; key?: string } = {
    limit: 20,
    windowMs: 60_000,
  },
): RateLimitResult {
  const now = Date.now();
  const ip = ipFrom(req);
  const key = opts.key ? `${opts.key}:${ip}` : ip;
  const windowMs = opts.windowMs;
  const limit = opts.limit;

  let bucket = buckets.get(key);
  if (!bucket) {
    // Naive size cap: on overflow, drop 20% of the oldest keys. Better than
    // an unbounded Map for a serverless container that may live for hours.
    if (buckets.size >= MAX_KEYS) {
      const dropCount = Math.floor(MAX_KEYS * 0.2);
      const iter = buckets.keys();
      for (let i = 0; i < dropCount; i++) {
        const k = iter.next().value;
        if (k !== undefined) buckets.delete(k);
      }
    }
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }

  // Drop timestamps that have aged out.
  const cutoff = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
    };
  }
  bucket.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - bucket.timestamps.length,
    retryAfterMs: 0,
  };
}

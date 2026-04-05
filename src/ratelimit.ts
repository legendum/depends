/**
 * Simple in-memory sliding-window rate limiter keyed by IP address.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // per window

/** Prune stale entries every 5 minutes */
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (now > w.resetAt) windows.delete(key);
  }
}, 5 * 60_000);

/**
 * Returns a 429 Response if the IP has exceeded the limit, or null if allowed.
 */
export function rateLimit(ip: string): Response | null {
  const now = Date.now();
  let w = windows.get(ip);

  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + WINDOW_MS };
    windows.set(ip, w);
  }

  w.count++;

  if (w.count > MAX_REQUESTS) {
    return Response.json(
      { error: "Rate limit exceeded. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((w.resetAt - now) / 1000)) },
      },
    );
  }

  return null;
}

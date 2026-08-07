"use client";

import { useEffect } from "react";

/**
 * Analytics, loaded LAZILY and deliberately kept out of the critical path.
 *
 * This used to `import posthog from "posthog-js"` at module scope, which put
 * ~200KB of analytics into the initial bundle — it had to be downloaded and
 * parsed before the app could render, on every visit, on every device. On a
 * phone over cellular that is a large part of why the app felt slow to open
 * or sometimes appeared not to load at all.
 *
 * Nothing here is needed for the app to work, so:
 *   - the import is dynamic, inside the effect, so it isn't in the initial
 *     bundle at all
 *   - it's deferred until the browser is idle, so it can't compete with the
 *     first render for main-thread time
 *   - every failure is swallowed; analytics must never break the page
 *
 * The `PostHogProvider` React context wrapper was also dropped: nothing in
 * this app calls `usePostHog()`, and keeping it would have forced the
 * library back into the synchronous path, defeating the whole point.
 */
export default function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    if (typeof window === "undefined") return;
    if ((window as any).__phInit) return;
    (window as any).__phInit = true;

    const start = () => {
      import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.init(key, {
            api_host:
              process.env.NEXT_PUBLIC_POSTHOG_HOST ??
              "https://us.i.posthog.com",
            person_profiles: "identified_only",
            capture_pageview: true,
            capture_pageleave: true,
            autocapture: true,
            // Respect Do Not Track
            respect_dnt: true,
          });
        })
        .catch(() => {
          // Analytics failing is not a user-visible problem.
        });
    };

    // Wait for idle so analytics never competes with first paint. The
    // setTimeout fallback covers Safari, which is exactly where this matters
    // most (iOS home-screen web app).
    const ric = (window as any).requestIdleCallback as
      ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
    if (ric) {
      const id = ric(start, { timeout: 5000 });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const t = setTimeout(start, 2500);
    return () => clearTimeout(t);
  }, []);

  return <>{children}</>;
}

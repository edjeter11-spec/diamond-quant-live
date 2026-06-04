"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  useEffect(() => {
    if (!key) return;
    if (typeof window === "undefined") return;
    if ((window as any).__phInit) return;
    (window as any).__phInit = true;

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      // Respect Do Not Track
      respect_dnt: true,
    });
  }, [key]);

  // When PostHog key isn't configured, just render children — no-op
  if (!key) return <>{children}</>;
  return <Provider client={posthog}>{children}</Provider>;
}

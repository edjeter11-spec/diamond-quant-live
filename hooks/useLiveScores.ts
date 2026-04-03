"use client";

import { useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";

export function useLiveScores(refreshInterval: number = 15000) {
  const { setScores } = useStore();

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch("/api/scores");
      const data = await res.json();
      setScores(data.games ?? []);
    } catch (error) {
      console.error("Failed to fetch scores:", error);
    }
  }, [setScores]);

  useEffect(() => {
    fetchScores();
    const interval = setInterval(fetchScores, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchScores, refreshInterval]);

  return { refresh: fetchScores };
}

"use client";

import { useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";

export function useOdds(refreshInterval: number = 30000) {
  const { setOddsData, setLoading } = useStore();

  const fetchOdds = useCallback(async () => {
    try {
      const res = await fetch("/api/odds");
      const data = await res.json();
      setOddsData(data.games ?? []);
    } catch (error) {
      console.error("Failed to fetch odds:", error);
    }
  }, [setOddsData]);

  useEffect(() => {
    fetchOdds();
    const interval = setInterval(fetchOdds, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchOdds, refreshInterval]);

  return { refresh: fetchOdds };
}

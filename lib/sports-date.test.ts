import { describe, it, expect } from "vitest";
import { etDateString, etDateOf } from "./sports-date";

// Guards against the UTC-vs-ET date-bucketing bug: raw ISO slicing rolls to
// the next calendar day at 8pm ET (midnight UTC) while games are still live,
// silently bucketing evening picks under tomorrow's key.
describe("etDateOf", () => {
  it("keeps a late-night UTC timestamp on the correct (earlier) ET day", () => {
    // 2026-07-30T02:00:00Z = 2026-07-29 10:00pm ET (EDT, UTC-4).
    // Naive `.toISOString().split('T')[0]` would wrongly return 2026-07-30.
    expect(etDateOf("2026-07-30T02:00:00Z")).toBe("2026-07-29");
  });

  it("maps a clearly-daytime UTC timestamp to the expected ET date", () => {
    // 2026-07-29T18:00:00Z = 2026-07-29 2:00pm ET (EDT, UTC-4).
    expect(etDateOf("2026-07-29T18:00:00Z")).toBe("2026-07-29");
  });

  it("rolls over correctly just after ET midnight", () => {
    // 2026-07-30T04:30:00Z = 2026-07-30 12:30am ET.
    expect(etDateOf("2026-07-30T04:30:00Z")).toBe("2026-07-30");
  });
});

describe("etDateString", () => {
  it("derives the same value as etDateOf for an equivalent Date object", () => {
    const iso = "2026-07-30T02:00:00Z";
    expect(etDateString(new Date(iso))).toBe(etDateOf(iso));
  });
});

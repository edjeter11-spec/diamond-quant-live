/**
 * Tier-based color coding for confidence percentages across the prop UI.
 *
 * Accepts a 0–100 percentage. Returns Tailwind class fragments for text,
 * background, border (and a solid bar fill) so badges/bars get instant
 * visual scanning without hand-rolling ternaries at every call site.
 *
 *   65%+   -> neon (green)   high confidence
 *   55-65% -> amber (yellow) medium confidence
 *   <55%   -> mercury (gray) low / muted
 */
export interface ConfidenceTier {
  text: string;
  bg: string;
  border: string;
  /** Solid color class for filled progress bars. */
  bar: string;
  /** Tier label, useful for screen-readers/tooltips. */
  label: "high" | "medium" | "low";
}

export function getConfidenceTier(value: number | null | undefined): ConfidenceTier {
  // Accept either 0-1 or 0-100 — normalize to 0-100.
  // Guard against undefined/null/NaN — without this, `undefined <= 1` is
  // false, leaving pct=undefined and silently returning the "low" tier for
  // legitimate picks that just lacked an explicit number.
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (numeric == null) {
    return {
      text: "text-mercury",
      bg: "bg-mercury/10",
      border: "border-mercury/20",
      bar: "bg-mercury",
      label: "low",
    };
  }
  const pct = numeric <= 1 ? numeric * 100 : numeric;

  if (pct >= 65) {
    return {
      text: "text-neon",
      bg: "bg-neon/10",
      border: "border-neon/30",
      bar: "bg-neon",
      label: "high",
    };
  }
  if (pct >= 55) {
    return {
      text: "text-amber",
      bg: "bg-amber/10",
      border: "border-amber/30",
      bar: "bg-amber",
      label: "medium",
    };
  }
  return {
    text: "text-mercury",
    bg: "bg-mercury/10",
    border: "border-mercury/20",
    bar: "bg-mercury",
    label: "low",
  };
}

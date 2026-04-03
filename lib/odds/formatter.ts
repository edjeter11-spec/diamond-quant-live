// ──────────────────────────────────────────────────────────
// Odds formatting utilities
// ──────────────────────────────────────────────────────────

export function formatAmerican(odds: number): string {
  if (odds === 0) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function formatDecimal(odds: number): string {
  return odds.toFixed(2);
}

export function formatImpliedProb(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

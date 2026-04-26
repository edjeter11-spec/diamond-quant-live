"use client";

/**
 * Skeleton — reusable shimmer block for perceived-performance loaders.
 * Use rounded shapes that mimic the final element. Keep colors in our
 * slate/gunmetal/mercury palette (no foreign greys).
 */
export function Skeleton({
  className = "",
  rounded = "rounded",
}: {
  className?: string;
  rounded?: "rounded" | "rounded-md" | "rounded-lg" | "rounded-xl" | "rounded-full";
}) {
  return (
    <div
      className={`animate-pulse bg-slate/20 ${rounded} ${className}`}
      aria-hidden="true"
    />
  );
}

/** Card-sized skeleton for game/pick cards. */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl border border-slate/20 bg-gunmetal/20 p-3 ${className}`}
      aria-hidden="true"
    >
      <div className="h-3 w-1/3 bg-slate/20 rounded mb-2" />
      <div className="h-4 w-2/3 bg-slate/20 rounded mb-3" />
      <div className="flex gap-2">
        <div className="h-3 w-12 bg-slate/20 rounded" />
        <div className="h-3 w-12 bg-slate/20 rounded" />
      </div>
    </div>
  );
}

/** Single row skeleton (player prop / pick row). */
export function SkeletonRow() {
  return (
    <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 animate-pulse" aria-hidden="true">
      <div className="w-7 h-7 rounded-full bg-slate/20 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3 w-2/3 bg-slate/20 rounded" />
        <div className="h-2.5 w-1/3 bg-slate/15 rounded" />
      </div>
      <div className="h-5 w-12 bg-slate/20 rounded" />
    </div>
  );
}

export default Skeleton;

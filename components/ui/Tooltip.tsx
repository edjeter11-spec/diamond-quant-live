"use client";

import { useState } from "react";

interface TooltipProps {
  term: string;
  explanation: string;
}

export default function Tooltip({ term, explanation }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((prev) => !prev)}
    >
      <span className="text-silver border-b border-dotted border-silver cursor-help">
        {term}
      </span>

      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 max-w-[250px] rounded-lg bg-bunker border border-slate/50 text-mercury text-xs p-2 whitespace-normal pointer-events-none">
          {explanation}
        </span>
      )}
    </span>
  );
}

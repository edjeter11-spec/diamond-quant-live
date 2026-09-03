"use client";

// Desktop hero. The old version was a marketing strip with three generic
// feature blurbs and no numbers. This one leads with the thing that actually
// sells the product: the graded record, pulled live from /api/bot-record —
// the same rows the Discord recaps and the admin Grading Health card read.
// Nothing here is a claim the site can't back with a settled pick.
//
// Hidden below `lg` so the phone board stays picks-first.

import { useEffect, useState } from "react";
import { Brain, Radio, ShieldCheck } from "lucide-react";
import { useSport } from "@/lib/sport-context";

type Rec = {
  wins: number;
  losses: number;
  pushes: number;
  graded: number;
  pending: number;
  unitsNet: number | null;
  days: number;
};

const FEATURES = [
  { icon: ShieldCheck, text: "Sharp-priced lines vs Pinnacle's fair price" },
  { icon: Brain, text: "Model-backed props with the edge math shown" },
  { icon: Radio, text: "Lines, injuries and scores as they move" },
];

export default function HeroBanner() {
  const { currentSport } = useSport();
  const [rec, setRec] = useState<Rec | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        // 7-day window first; if it's thin (early season, off week) fall
        // back to 30 days so the tile isn't "1-0".
        const load = async (days: number) => {
          const r = await fetch(
            `/api/bot-record?sport=${currentSport}&days=${days}`,
            { signal: AbortSignal.timeout(8000) },
          );
          const d = await r.json();
          return d?.ok && d.record
            ? ({ ...d.record, unitsNet: d.unitsNet ?? null, days } as Rec)
            : null;
        };
        let r = await load(7);
        if (!r || r.graded < 5) r = (await load(30)) ?? r;
        if (!dead) setRec(r);
      } catch {
        if (!dead) setRec(null);
      }
    })();
    return () => {
      dead = true;
    };
  }, [currentSport]);

  // Nothing graded yet (a sport's season hasn't started) — say so rather
  // than printing a 0-0, +0.0u record that reads like a broken counter.
  const fresh = rec != null && rec.graded === 0;
  const units = fresh ? null : (rec?.unitsNet ?? null);
  const unitsTone =
    units == null ? "text-silver" : units >= 0 ? "text-neon" : "text-danger";

  return (
    <section className="hidden lg:block relative overflow-hidden rounded-2xl glass">
      <div
        aria-hidden
        className="absolute -right-32 -top-40 w-[28rem] h-[28rem] rounded-full bg-neon/[0.07] blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -left-24 -bottom-32 w-80 h-80 rounded-full bg-electric/[0.06] blur-3xl"
      />

      <div className="relative grid grid-cols-[1.25fr_1fr] gap-8 px-7 py-6">
        {/* Left — headline + capability list */}
        <div className="min-w-0">
          <p className="eyebrow mb-3">
            Quant Betting · {currentSport.toUpperCase()}
          </p>
          <h2 className="text-[2rem] xl:text-[2.4rem] font-display font-bold text-silver leading-[1.05]">
            Sharp lines.
            <span className="block text-neon">Real receipts.</span>
          </h2>
          <p className="mt-3 text-sm text-mercury max-w-md leading-relaxed">
            Every pick is priced against the sharpest book in the world,
            published before first pitch, and graded against the final score —
            win or lose.
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {FEATURES.map((f) => (
              <li
                key={f.text}
                className="flex items-center gap-2 text-xs text-mercury"
              >
                <f.icon className="w-3.5 h-3.5 text-electric flex-shrink-0" />
                {f.text}
              </li>
            ))}
          </ul>
        </div>

        {/* Right — the record. Three tiles, real numbers. */}
        <div className="grid grid-cols-3 gap-3 self-center">
          <Tile
            label={rec && !fresh ? `Last ${rec.days} days` : "Record"}
            value={rec && !fresh ? `${rec.wins}-${rec.losses}` : "—"}
            sub={
              fresh
                ? "season opens soon"
                : rec && rec.pushes > 0
                  ? `${rec.pushes} push${rec.pushes === 1 ? "" : "es"}`
                  : "graded picks"
            }
            tone="text-silver"
          />
          <Tile
            label="Units"
            value={
              units == null
                ? "—"
                : `${units >= 0 ? "+" : ""}${units.toFixed(1)}u`
            }
            sub="flat 1u stakes"
            tone={unitsTone}
          />
          <Tile
            label="Settled"
            value={rec && !fresh ? String(rec.graded) : "—"}
            sub={
              fresh
                ? "first grades after kickoff"
                : rec && rec.pending > 0
                  ? `${rec.pending} pending`
                  : "vs final scores"
            }
            tone="text-silver"
          />
        </div>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p className={`stat-num text-[1.75rem] xl:text-[2rem] mt-2 ${tone}`}>
        {value}
      </p>
      <p className="text-[11px] text-mercury/80 mt-1.5">{sub}</p>
    </div>
  );
}

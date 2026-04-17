import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  );

  try {
    const { data } = await supabase.from("shared_slips").select("slip_data").eq("id", id).single();
    const picks = data?.slip_data?.picks ?? [];
    const totalOdds = data?.slip_data?.totalOdds;
    const sharedBy = data?.slip_data?.sharedBy ?? "a sharp";

    const legLabel = picks.length > 1 ? `${picks.length}-leg parlay` : "straight pick";
    const oddsLabel = totalOdds ? ` @ ${totalOdds > 0 ? "+" : ""}${Math.round(totalOdds)}` : "";
    const firstPick = picks[0]?.pick ? `: ${picks[0].pick}` : "";

    const title = `${sharedBy}'s ${legLabel}${oddsLabel} — Diamond Quant`;
    const description = picks.length > 0
      ? `${picks.slice(0, 3).map((p: any) => p.pick).join(" • ")}${picks.length > 3 ? ` • +${picks.length - 3} more` : ""}${firstPick ? "" : ""}`
      : "A shared bet slip from Diamond-Quant Live — +EV picks, live odds, quant edge.";

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "Diamond-Quant Live",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  } catch {
    return {
      title: "Shared Bet Slip — Diamond Quant Live",
      description: "Quant-driven +EV sports picks.",
    };
  }
}

export default function SlipLayout({ children }: { children: React.ReactNode }) {
  return children;
}

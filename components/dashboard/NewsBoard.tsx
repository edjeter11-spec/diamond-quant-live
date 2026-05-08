"use client";

import { useEffect, useState } from "react";
import { Newspaper, AlertTriangle, RefreshCw, Activity, Clock } from "lucide-react";

interface NewsItem {
  type: "injury" | "lineup" | "trade" | "general";
  player: string;
  team: string;
  status?: string;
  description: string;
  timestamp: string;
  priority: number;
}

export default function NewsBoard() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [counts, setCounts] = useState<{ out: number; doubtful: number; questionable: number; general: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nba-news?_=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setCounts(data.counts ?? null);
        setUpdatedAt(data.generatedAt ?? new Date().toISOString());
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(id);
  }, []);

  const statusColor = (s?: string) =>
    s === "Out" ? "text-danger border-danger/30 bg-danger/10"
      : s === "Doubtful" ? "text-amber border-amber/30 bg-amber/10"
      : s === "Questionable" ? "text-electric border-electric/30 bg-electric/10"
      : "text-mercury border-slate/30 bg-gunmetal/30";

  const timeAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <div className="space-y-3">
      <div className="glass rounded-xl overflow-hidden border border-electric/20">
        <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-purple/5 border-b border-electric/15 flex items-center gap-3">
          <Newspaper className="w-5 h-5 text-electric" />
          <div className="flex-1">
            <h2 className="text-sm font-bold text-silver">NBA News & Injuries</h2>
            <p className="text-[10px] text-mercury/60">Live ESPN feed • refreshes every 5 min</p>
          </div>
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-gunmetal/40 text-mercury hover:text-silver transition-colors"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {counts && (counts.out > 0 || counts.doubtful > 0 || counts.questionable > 0) && (
          <div className="grid grid-cols-3 gap-px bg-slate/10">
            <div className="px-3 py-2 text-center bg-bunker">
              <p className="text-lg font-bold font-mono text-danger">{counts.out}</p>
              <p className="text-[9px] text-mercury/60 uppercase">OUT</p>
            </div>
            <div className="px-3 py-2 text-center bg-bunker">
              <p className="text-lg font-bold font-mono text-amber">{counts.doubtful}</p>
              <p className="text-[9px] text-mercury/60 uppercase">Doubtful</p>
            </div>
            <div className="px-3 py-2 text-center bg-bunker">
              <p className="text-lg font-bold font-mono text-electric">{counts.questionable}</p>
              <p className="text-[9px] text-mercury/60 uppercase">Questionable</p>
            </div>
          </div>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="glass rounded-xl p-6 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 text-electric animate-spin" />
          <span className="text-sm text-mercury">Loading news...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <Newspaper className="w-8 h-8 text-mercury/30 mx-auto mb-2" />
          <p className="text-sm text-mercury">No news right now.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div
              key={`${it.player}-${i}`}
              className={`glass rounded-xl p-3 flex items-start gap-3 border-l-4 ${
                it.priority >= 8 ? "border-l-danger" : it.priority >= 5 ? "border-l-amber" : "border-l-electric/40"
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {it.type === "injury" ? (
                  <AlertTriangle className={`w-4 h-4 ${it.priority >= 8 ? "text-danger" : "text-amber"}`} />
                ) : (
                  <Activity className="w-4 h-4 text-electric" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-silver truncate">{it.player}</span>
                  {it.team && <span className="text-[10px] text-mercury/50">{it.team}</span>}
                  {it.status && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${statusColor(it.status)}`}>
                      {it.status.toUpperCase()}
                    </span>
                  )}
                </div>
                {it.description && (
                  <p className="text-[11px] text-mercury/80 leading-tight line-clamp-2">{it.description}</p>
                )}
                <div className="flex items-center gap-1 mt-1 text-[9px] text-mercury/40">
                  <Clock className="w-2.5 h-2.5" />
                  {timeAgo(it.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {updatedAt && (
        <p className="text-center text-[9px] text-mercury/40">
          Updated {timeAgo(updatedAt)}
        </p>
      )}
    </div>
  );
}

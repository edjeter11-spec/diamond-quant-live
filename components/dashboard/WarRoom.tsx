"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { Users, Copy, Check, LogIn, Plus, Send, Share2, LogOut, Zap } from "lucide-react";

interface RoomMember {
  username: string;
  joinedAt: string;
}

interface FeedItem {
  id: string;
  username: string;
  type: "join" | "leave" | "pick" | "message";
  content: string;
  timestamp: string;
}

const QUICK_PICKS = [
  "Bet the over", "Fade this line", "Strong play here",
  "Wait for a better number", "Taking the ML", "Fading the public",
];

function genUsername() {
  const adj = ["Sharp", "Fade", "Value", "Edge", "Lock", "Steel"];
  const noun = ["Hawk", "Wolf", "Bull", "Bear", "Fox", "Ghost"];
  return `${adj[Math.floor(Math.random() * adj.length)]}${noun[Math.floor(Math.random() * noun.length)]}${Math.floor(Math.random() * 99) + 1}`;
}

export default function WarRoom() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState("");
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [connecting, setConnecting] = useState(false);

  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const usernameRef = useRef<string>("");

  if (!usernameRef.current) {
    const stored = typeof window !== "undefined" ? localStorage.getItem("dq_war_room_username") : null;
    usernameRef.current = stored || genUsername();
    if (typeof window !== "undefined") localStorage.setItem("dq_war_room_username", usernameRef.current);
  }
  const username = usernameRef.current;

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feed]);

  useEffect(() => () => { channelRef.current?.unsubscribe(); }, []);

  const addFeedItem = (item: Omit<FeedItem, "id">) => {
    setFeed(f => [...f.slice(-99), { ...item, id: `${Date.now()}-${Math.random()}` }]);
  };

  const leaveRoom = useCallback(() => {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setRoomCode(null);
    setMembers([]);
    setFeed([]);
  }, []);

  const joinRoom = useCallback(async (code: string) => {
    if (!supabase) return;
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!normalized) return;

    setConnecting(true);
    channelRef.current?.unsubscribe();

    const channel = supabase.channel(`dq-war-room:${normalized}`, {
      config: { presence: { key: username } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ username: string; joinedAt: string }>();
        const list: RoomMember[] = Object.values(state).flat().map((m) => ({
          username: (m as any).username ?? "",
          joinedAt: (m as any).joinedAt ?? new Date().toISOString(),
        }));
        setMembers(list);
      })
      .on("presence", { event: "join" }, ({ newPresences }: any) => {
        for (const p of newPresences) {
          if (p.username && p.username !== username) {
            addFeedItem({ username: p.username, type: "join", content: "joined the room", timestamp: new Date().toISOString() });
          }
        }
      })
      .on("presence", { event: "leave" }, ({ leftPresences }: any) => {
        for (const p of leftPresences) {
          if (p.username) {
            addFeedItem({ username: p.username, type: "leave", content: "left the room", timestamp: new Date().toISOString() });
          }
        }
      })
      .on("broadcast", { event: "pick" }, ({ payload }: any) => {
        if (payload?.username !== username) {
          addFeedItem({ username: payload.username, type: "pick", content: payload.content, timestamp: new Date().toISOString() });
        }
      })
      .on("broadcast", { event: "message" }, ({ payload }: any) => {
        if (payload?.username !== username) {
          addFeedItem({ username: payload.username, type: "message", content: payload.content, timestamp: new Date().toISOString() });
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ username, joinedAt: new Date().toISOString() });
          setRoomCode(normalized);
          setConnecting(false);
          addFeedItem({ username, type: "join", content: "joined the room", timestamp: new Date().toISOString() });
        }
      });

    channelRef.current = channel;
  }, [username]);

  const handleCreateRoom = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    joinRoom(code);
  };

  const handleJoinRoom = () => {
    if (inputCode.trim().length >= 4) joinRoom(inputCode);
  };

  const copyCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendMessage = async () => {
    if (!channelRef.current || !chatInput.trim()) return;
    const content = chatInput.trim();
    setChatInput("");
    await channelRef.current.send({ type: "broadcast", event: "message", payload: { username, content } });
    addFeedItem({ username, type: "message", content, timestamp: new Date().toISOString() });
  };

  const sharePick = async (content: string) => {
    if (!channelRef.current) return;
    await channelRef.current.send({ type: "broadcast", event: "pick", payload: { username, content } });
    addFeedItem({ username, type: "pick", content, timestamp: new Date().toISOString() });
  };

  if (!supabase) {
    return (
      <div className="glass rounded-xl p-6 text-center">
        <Users className="w-10 h-10 text-mercury/30 mx-auto mb-3" />
        <p className="text-sm text-mercury/50">Supabase not connected — War Room unavailable.</p>
      </div>
    );
  }

  // ── Lobby ──
  if (!roomCode) {
    return (
      <div className="glass rounded-xl p-6 sm:p-8 text-center max-w-md mx-auto">
        <div className="w-12 h-12 rounded-full bg-electric/10 flex items-center justify-center mx-auto mb-4">
          <Users className="w-6 h-6 text-electric" />
        </div>
        <h2 className="text-lg font-bold text-silver mb-1">War Room</h2>
        <p className="text-sm text-mercury/60 mb-6 max-w-xs mx-auto">
          Create a shared room. Everyone sees the same picks and alerts in real time.
        </p>
        <div className="space-y-3">
          <button
            onClick={handleCreateRoom}
            disabled={connecting}
            className="w-full py-2.5 bg-neon/15 text-neon border border-neon/30 rounded-lg font-semibold text-sm hover:bg-neon/25 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {connecting ? "Connecting..." : "Create Room"}
          </button>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputCode}
              onChange={e => setInputCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleJoinRoom()}
              placeholder="ROOM CODE"
              maxLength={8}
              className="flex-1 px-4 py-2.5 bg-gunmetal/50 border border-slate/30 rounded-lg text-sm text-silver focus:outline-none focus:border-electric/40 font-mono uppercase tracking-widest"
            />
            <button
              onClick={handleJoinRoom}
              disabled={connecting || inputCode.trim().length < 4}
              className="px-4 py-2.5 bg-electric/15 text-electric border border-electric/30 rounded-lg font-semibold text-sm hover:bg-electric/25 transition-colors flex items-center gap-1.5 flex-shrink-0 disabled:opacity-40"
            >
              <LogIn className="w-4 h-4" />
              Join
            </button>
          </div>
        </div>
        <p className="text-xs text-mercury/30 mt-5">Powered by Supabase Realtime</p>
      </div>
    );
  }

  // ── Active Room ──
  return (
    <div className="space-y-3">
      {/* Room header */}
      <div className="glass rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-neon animate-pulse" />
            <span className="text-xs text-mercury/60 font-semibold uppercase tracking-wider">Live</span>
          </div>
          <button
            onClick={copyCode}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gunmetal/60 border border-slate/20 rounded-lg font-mono text-sm text-electric hover:border-electric/40 transition-colors"
            title="Copy room code"
          >
            {roomCode}
            {copied ? <Check className="w-3.5 h-3.5 text-neon" /> : <Copy className="w-3.5 h-3.5 opacity-40" />}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-mercury/50">
            <span className="text-silver font-semibold">{members.length}</span> online
          </span>
          <button
            onClick={leaveRoom}
            className="p-1.5 text-mercury/40 hover:text-danger transition-colors"
            title="Leave room"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Members panel */}
        <div className="glass rounded-xl p-4">
          <p className="text-xs font-semibold text-mercury/50 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Members
          </p>
          <div className="space-y-2.5">
            {members.map(m => (
              <div key={m.username} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-neon flex-shrink-0" />
                <span className={`text-xs font-mono truncate ${m.username === username ? "text-neon" : "text-silver"}`}>
                  {m.username}{m.username === username ? " (you)" : ""}
                </span>
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-xs text-mercury/30 italic">Waiting for others...</p>
            )}
          </div>
          <p className="text-[10px] text-mercury/30 mt-4 font-mono">You: {username}</p>
        </div>

        {/* Activity feed + chat */}
        <div className="sm:col-span-2 glass rounded-xl p-4 flex flex-col">
          <p className="text-xs font-semibold text-mercury/50 uppercase tracking-wider mb-3">Activity</p>
          <div
            ref={feedRef}
            className="flex-1 min-h-[160px] max-h-[220px] overflow-y-auto space-y-1.5 pr-1 scrollbar-thin"
          >
            {feed.length === 0 && (
              <p className="text-xs text-mercury/30 text-center pt-6 italic">No activity yet — share a pick below</p>
            )}
            {feed.map(item => (
              <div key={item.id} className={`text-xs leading-relaxed ${item.type === "pick" ? "bg-neon/5 border border-neon/15 rounded-lg px-2.5 py-1.5" : "px-0.5 py-0.5"}`}>
                {(item.type === "join" || item.type === "leave") ? (
                  <span className="text-mercury/35 italic">{item.username} {item.content}</span>
                ) : item.type === "pick" ? (
                  <span>
                    <Zap className="w-3 h-3 text-neon inline mr-1 -mt-0.5" />
                    <span className="text-neon font-semibold">{item.username}</span>
                    <span className="text-mercury/50">: </span>
                    <span className="text-silver">{item.content}</span>
                  </span>
                ) : (
                  <span>
                    <span className={`font-semibold ${item.username === username ? "text-electric" : "text-silver"}`}>
                      {item.username}
                    </span>
                    <span className="text-mercury/50">: </span>
                    <span className="text-mercury/80">{item.content}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3 pt-3 border-t border-slate/20">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder="Message the room..."
              className="flex-1 px-3 py-2 bg-gunmetal/50 border border-slate/30 rounded-lg text-xs text-silver placeholder:text-mercury/30 focus:outline-none focus:border-electric/30"
            />
            <button
              onClick={sendMessage}
              disabled={!chatInput.trim()}
              className="px-3 py-2 bg-electric/15 text-electric border border-electric/30 rounded-lg hover:bg-electric/25 transition-colors flex-shrink-0 disabled:opacity-30"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick pick share */}
      <div className="glass rounded-xl p-4">
        <p className="text-xs font-semibold text-mercury/50 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5" /> Share a Pick
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_PICKS.map(q => (
            <button
              key={q}
              onClick={() => sharePick(q)}
              className="px-3 py-1.5 bg-gunmetal/50 border border-slate/25 rounded-lg text-xs text-mercury/70 hover:text-silver hover:border-neon/30 hover:bg-neon/5 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

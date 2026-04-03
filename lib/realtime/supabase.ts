// ──────────────────────────────────────────────────────────
// Supabase Realtime — War Room Collaboration
// ──────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export interface RoomUpdate {
  type: "lineup_change" | "pitching_change" | "weather_update" | "odds_alert" | "chat" | "parlay_shared";
  userId: string;
  userName: string;
  data: any;
  timestamp: string;
}

// Generate a shareable room code
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Subscribe to a room channel
export function subscribeToRoom(
  roomId: string,
  userId: string,
  userName: string,
  onUpdate: (update: RoomUpdate) => void,
  onPresence: (users: Array<{ id: string; name: string; isOnline: boolean }>) => void
) {
  if (!supabase) {
    console.warn("Supabase not configured — room features disabled");
    return null;
  }

  const channel = supabase.channel(`room:${roomId}`, {
    config: { presence: { key: userId } },
  });

  // Handle broadcasts
  channel.on("broadcast", { event: "update" }, ({ payload }) => {
    onUpdate(payload as RoomUpdate);
  });

  // Handle presence
  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const users = Object.entries(state).map(([key, presences]) => {
      const p = (presences as any[])[0];
      return { id: key, name: p.name || "Unknown", isOnline: true };
    });
    onPresence(users);
  });

  // Subscribe and track presence
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ name: userName, joinedAt: new Date().toISOString() });
    }
  });

  return channel;
}

// Send an update to the room
export function sendRoomUpdate(
  roomId: string,
  update: RoomUpdate
) {
  if (!supabase) return;

  const channel = supabase.channel(`room:${roomId}`);
  channel.send({
    type: "broadcast",
    event: "update",
    payload: update,
  });
}

// Share a parlay with the room
export function shareParlay(
  roomId: string,
  userId: string,
  userName: string,
  parlay: any
) {
  sendRoomUpdate(roomId, {
    type: "parlay_shared",
    userId,
    userName,
    data: parlay,
    timestamp: new Date().toISOString(),
  });
}

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useStore } from "@/lib/store";
import { subscribeToRoom, sendRoomUpdate, generateRoomCode, type RoomUpdate } from "@/lib/realtime/supabase";

export function useRoom(userName: string = "User") {
  const { roomId, setRoomId, setRoomUsers } = useStore();
  const channelRef = useRef<any>(null);
  const userIdRef = useRef(`user-${Math.random().toString(36).slice(2, 8)}`);

  const createRoom = useCallback(() => {
    const code = generateRoomCode();
    setRoomId(code);
    return code;
  }, [setRoomId]);

  const joinRoom = useCallback((code: string) => {
    setRoomId(code);
  }, [setRoomId]);

  const leaveRoom = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }
    setRoomId(null);
    setRoomUsers([]);
  }, [setRoomId, setRoomUsers]);

  const sendUpdate = useCallback((update: Omit<RoomUpdate, "userId" | "userName" | "timestamp">) => {
    if (!roomId) return;
    sendRoomUpdate(roomId, {
      ...update,
      userId: userIdRef.current,
      userName,
      timestamp: new Date().toISOString(),
    });
  }, [roomId, userName]);

  useEffect(() => {
    if (!roomId) return;

    const channel = subscribeToRoom(
      roomId,
      userIdRef.current,
      userName,
      (update) => {
        // Handle incoming updates
        console.log("[Room] Update:", update);
      },
      (users) => {
        setRoomUsers(users);
      }
    );

    channelRef.current = channel;

    return () => {
      if (channel) channel.unsubscribe();
    };
  }, [roomId, userName, setRoomUsers]);

  return { roomId, createRoom, joinRoom, leaveRoom, sendUpdate };
}

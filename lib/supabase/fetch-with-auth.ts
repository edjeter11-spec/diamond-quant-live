// Helper for client-side fetches that need to authenticate the user with the server.
// Adds Authorization: Bearer <access_token> from the active Supabase session.

import { supabase } from "./client";

export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {}
  }
  return fetch(input, { ...init, headers });
}

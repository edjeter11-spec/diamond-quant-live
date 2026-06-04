import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

interface Subscriber {
  email: string;
  source: string;
  addedAt: string;
  utm?: Record<string, string>;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 120;
}

// Simple in-memory rate limit: 3 attempts per IP per hour. Prevents pollution.
const ATTEMPTS = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const slot = ATTEMPTS.get(ip);
  if (!slot || slot.reset < now) {
    ATTEMPTS.set(ip, { count: 1, reset: now + 60 * 60 * 1000 });
    return true;
  }
  if (slot.count >= 3) return false;
  slot.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(ip)) {
      return NextResponse.json({ ok: false, error: "Too many attempts — try later" }, { status: 429 });
    }
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const source = String(body.source ?? "track-record").slice(0, 40);
    const utm = body.utm && typeof body.utm === "object" ? body.utm : undefined;

    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
    }

    const list = ((await cloudGet<Subscriber[]>("email_subscribers", [])) ?? []) as Subscriber[];
    if (list.some((s) => s.email === email)) {
      return NextResponse.json({ ok: true, message: "Already subscribed", duplicate: true });
    }

    const next: Subscriber[] = [
      { email, source, addedAt: new Date().toISOString(), utm },
      ...list,
    ].slice(0, 5000);

    const result = await cloudSet("email_subscribers", next);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? "Save failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, count: next.length });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}

export async function GET() {
  const list = ((await cloudGet<Subscriber[]>("email_subscribers", [])) ?? []) as Subscriber[];
  return NextResponse.json({ count: list.length });
}

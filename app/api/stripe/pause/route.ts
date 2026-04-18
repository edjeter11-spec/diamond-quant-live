// Pause (or resume) a user's Pro subscription via Stripe.
// Reduces churn dramatically vs. hard cancel: ~20-40% save rate in SaaS.

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-03-31.basil" as any });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Auth required" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  try {
    const { action } = await req.json(); // "pause" | "resume"
    if (action !== "pause" && action !== "resume") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Look up the user's Stripe customer id
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: "No active subscription" }, { status: 404 });
    }

    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
      limit: 1,
    });
    const sub = subs.data[0];
    if (!sub) return NextResponse.json({ error: "No active subscription" }, { status: 404 });

    if (action === "pause") {
      // Pause for 30 days — user keeps access until period ends, then no charges
      const resumeAt = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
      await stripe.subscriptions.update(sub.id, {
        pause_collection: { behavior: "void", resumes_at: resumeAt },
      });
      await supabaseAdmin.from("user_profiles").update({
        subscription_status: "paused",
      }).eq("id", user.id);
      return NextResponse.json({ ok: true, paused: true, resumesAt: resumeAt });
    }

    // Resume immediately
    await stripe.subscriptions.update(sub.id, { pause_collection: null });
    await supabaseAdmin.from("user_profiles").update({
      subscription_status: "active",
    }).eq("id", user.id);
    return NextResponse.json({ ok: true, paused: false });
  } catch (e: any) {
    console.error("pause subscription error:", e);
    return NextResponse.json({ error: e.message ?? "Failed" }, { status: 500 });
  }
}

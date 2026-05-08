import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-03-31.basil" as any });
}
function getSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const supabase = getSupabase();
      if (userId && supabase) {
        // Mark user as premium
        await supabase.from("user_profiles").update({
          is_premium: true,
          stripe_customer_id: session.customer as string,
          subscription_status: "active",
        }).eq("id", userId);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const supabase = getSupabase();
      if (!supabase) break;
      // Find user by customer ID and downgrade
      const { data } = await supabase.from("user_profiles")
        .select("id")
        .eq("stripe_customer_id", sub.customer as string)
        .single();
      if (data) {
        await supabase.from("user_profiles").update({
          is_premium: false,
          subscription_status: "canceled",
        }).eq("id", data.id);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}

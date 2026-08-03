import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getUserFromRequest } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-03-31.basil" as any,
  });
}

export async function POST(req: NextRequest) {
  try {
    // Identity comes from the verified session, never the request body.
    //
    // This route previously took userId and email straight off the JSON body
    // with no auth at all. The webhook then trusts session.metadata.userId to
    // set is_premium, so anyone could (a) pass an arbitrary priceId — including
    // a cheap or $0 price — and receive a signature-valid webhook granting
    // premium, or (b) pass someone else's userId and attach their payment to
    // another account.
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to subscribe" },
        { status: 401 },
      );
    }

    const { priceId } = await req.json();

    // Only the configured price is sellable. Without this the client picks
    // the amount it pays.
    const allowedPrice = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;
    if (!allowedPrice) {
      return NextResponse.json(
        { error: "Billing not configured" },
        { status: 503 },
      );
    }
    if (priceId !== allowedPrice) {
      return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: allowedPrice, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://diamond-quant-live.vercel.app"}/pricing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://diamond-quant-live.vercel.app"}/pricing?canceled=true`,
      customer_email: user.email,
      metadata: { userId: user.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

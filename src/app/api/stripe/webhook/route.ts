import { NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/billing/webhook";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "not_configured" }, { status: 400 });
  const body = await req.text();
  try {
    return NextResponse.json(await handleStripeWebhook(body, signature, secret));
  } catch (e) {
    const bad = (e as Error).constructor.name.includes("Signature");
    if (!bad) console.error(e);
    return NextResponse.json({ error: bad ? "bad_signature" : "handler_failed" }, { status: bad ? 400 : 500 });
  }
}

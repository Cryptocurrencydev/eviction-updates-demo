import Stripe from "stripe";
import { withSystem } from "../db";
import { applyBillingEvent, type BillingEvent } from "./events";

/** Verifies the signature against the raw body, then hands off. Throws on a bad signature. */
export async function handleStripeWebhook(rawBody: string, signature: string, secret: string) {
  const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  return withSystem((tx) => applyBillingEvent(tx, event as unknown as BillingEvent, "stripe"));
}

import { firmRoute } from "@/lib/api";
import { createPortal, stripeEnabled } from "@/lib/billing/stripe";

export const POST = firmRoute(async (ctx) => {
  if (!stripeEnabled()) throw Object.assign(new Error("Stripe isn't configured here. Use the simulator below."), { code: "DL002" });
  return { url: await createPortal(ctx) };
}, { admin: true });

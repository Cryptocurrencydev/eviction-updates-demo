import { firmRoute } from "@/lib/api";
import { withFirm } from "@/lib/db";
import { handleInbound } from "@/lib/messaging/inbound";

/** The simulated phone. Goes through the same handler as the Twilio webhook. */
export const POST = firmRoute(async (ctx, _s, req) => {
  const { ownerId, body } = await req.json();
  if (typeof body !== "string" || !body.trim()) throw Object.assign(new Error("Type a reply first."), { code: "DL002" });
  const phone = await withFirm(ctx, async (tx) => (await tx.query("select phone from owners where id = $1", [ownerId])).rows[0]?.phone);
  if (!phone) throw Object.assign(new Error("Owner not found."), { code: "DL404" });
  return { outcome: await handleInbound(ctx.firmId, phone, body) };
});

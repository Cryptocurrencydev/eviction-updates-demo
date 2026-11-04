import { firmRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { withFirm } from "@/lib/db";

export const POST = firmRoute(async (ctx, _s, req) => {
  const { phone, email } = await req.json();
  if (!String(phone ?? "").trim() || !String(email ?? "").includes("@")) {
    throw Object.assign(new Error("Enter a phone number and an email."), { code: "DL002" });
  }
  await withFirm(ctx, async (tx) => {
    await tx.query("update firm_settings set contact_phone = $2, contact_email = $3 where firm_id = $1", [ctx.firmId, phone, email]);
    await audit(tx, ctx.firmId, ctx.actor, "settings.updated", { contact_phone: phone, contact_email: email });
  });
}, { admin: true });

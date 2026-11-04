import { firmRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { withFirm } from "@/lib/db";
import { unknownPlaceholders } from "@/lib/messaging/render";

export const POST = firmRoute(async (ctx, _s, req) => {
  const { stage, body } = await req.json();
  const text = String(body ?? "").trim();
  if (!text) throw Object.assign(new Error("A text can't be empty."), { code: "DL002" });
  if (text.length > 320) throw Object.assign(new Error("Keep it to two SMS segments (320 characters)."), { code: "DL002" });
  const bad = unknownPlaceholders(text);
  if (bad.length) throw Object.assign(new Error(`Unknown placeholder: {${bad[0]}}`), { code: "DL002" });
  return withFirm(ctx, async (tx) => {
    const { rows } = await tx.query("select sends_text from stages where code = $1", [stage]);
    if (!rows[0]?.sends_text) throw Object.assign(new Error("This stage has no owner text."), { code: "DL002" });
    await tx.query(
      `insert into templates (firm_id, stage_code, body) values ($1,$2,$3)
       on conflict (firm_id, stage_code) do update set body = excluded.body, updated_at = now()`,
      [ctx.firmId, stage, text],
    );
    await audit(tx, ctx.firmId, ctx.actor, "template.updated", { stage, body: text });
  });
}, { admin: true });

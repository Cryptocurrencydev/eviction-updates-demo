import { firmRoute } from "@/lib/api";
import { advanceMany, RECORDED_FIRST, recordResult } from "@/lib/cases";

/** Results recorded here wait on the team screen. Everything else moves and texts now. `direct` skips that wait. */
export const POST = firmRoute(async (ctx, _s, req) => {
  const { caseIds, to, fields, direct } = await req.json();
  if (!Array.isArray(caseIds) || caseIds.length === 0 || typeof to !== "string") {
    throw Object.assign(new Error("Pick at least one case and an action."), { code: "DL002" });
  }
  if (RECORDED_FIRST.has(to) && !direct) return recordResult(ctx, caseIds, to);
  return advanceMany(ctx, caseIds, to, fields ?? {});
});

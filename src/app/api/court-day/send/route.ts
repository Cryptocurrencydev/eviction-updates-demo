import { firmRoute } from "@/lib/api";
import { SEND_GROUPS, sendGroup, type SendGroup } from "@/lib/cases";

export const POST = firmRoute(async (ctx, _s, req) => {
  const { group, dates } = await req.json();
  if (!(group in SEND_GROUPS)) throw Object.assign(new Error("Unknown group."), { code: "DL404" });
  return sendGroup(ctx, group as SendGroup, dates ?? {});
});

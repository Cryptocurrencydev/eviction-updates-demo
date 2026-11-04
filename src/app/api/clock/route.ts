import { firmRoute } from "@/lib/api";
import { advanceClock } from "@/lib/cases";

export const POST = firmRoute(async (ctx, _s, req) => {
  const { hours } = await req.json();
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) throw Object.assign(new Error("Pick between 1 hour and 30 days."), { code: "DL002" });
  return advanceClock(ctx, hours);
});

import { firmRoute } from "@/lib/api";
import { commitCsv } from "@/lib/csv";

export const maxDuration = 60;
export const POST = firmRoute(async (ctx, _s, req) => {
  const { text, filename } = await req.json();
  return commitCsv(ctx, String(filename ?? "upload.csv"), String(text ?? ""));
});

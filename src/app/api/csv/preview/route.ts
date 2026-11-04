import { firmRoute } from "@/lib/api";
import { previewCsv } from "@/lib/csv";

export const POST = firmRoute(async (ctx, _s, req) => {
  const { text } = await req.json();
  return previewCsv(ctx, String(text ?? ""));
});

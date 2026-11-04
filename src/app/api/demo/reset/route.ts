import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { withSystem } from "@/lib/db";
import { DEMO_FIRMS, resetFirm } from "@/lib/seed";

/** Public on purpose: a reviewer must be able to restart the demo from the login page. */
export async function POST() {
  try {
    await withSystem(async (tx) => {
      for (const f of DEMO_FIRMS) await resetFirm(tx, f.slug, "Demo reset");
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

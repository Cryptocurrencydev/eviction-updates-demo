import { firmRoute } from "@/lib/api";
import { verifyChain } from "@/lib/audit";
import { withFirm } from "@/lib/db";

export const POST = firmRoute((ctx) => withFirm(ctx, verifyChain));

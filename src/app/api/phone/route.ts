import { firmRoute } from "@/lib/api";
import { withFirm } from "@/lib/db";
import { loadFirm } from "@/lib/messaging/outbox";
import { consentRecords, phoneOwners, phoneThread } from "@/lib/phone";

export const GET = firmRoute(async (ctx, _s, req) => {
  const url = new URL(req.url);
  return withFirm(ctx, async (tx) => {
    const firm = await loadFirm(tx);
    const owners = await phoneOwners(tx);
    const ownerId = url.searchParams.get("owner") ?? owners[0]?.id;
    const owner = owners.find((o) => o.id === ownerId) ?? owners[0] ?? null;
    return {
      owners, owner, now: firm.demo_now, firmName: firm.name,
      messages: owner ? await phoneThread(tx, owner.id) : [],
      consent: owner ? await consentRecords(tx, owner.id) : [],
    };
  });
});

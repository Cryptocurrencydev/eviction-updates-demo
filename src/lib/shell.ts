import "server-only";
import { getBilling } from "./billing/events";
import { withFirm, type FirmCtx } from "./db";
import { loadFirm } from "./messaging/outbox";
import { getReminders } from "./reminders";

export const getShell = (ctx: FirmCtx) =>
  withFirm(ctx, async (tx) => {
    const firm = await loadFirm(tx);
    const billing = await getBilling(tx);
    const reminders = await getReminders(tx);
    const { rows } = await tx.query("select count(*)::int as n from messages where status = 'queued' and quiet_held");
    return { firm, billing, reminderCount: reminders.length, queued: rows[0].n as number };
  });

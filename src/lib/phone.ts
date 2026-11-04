import type { Tx } from "./db";

export type PhoneOwner = { id: string; name: string; phone: string; timezone: string; consent: string; address: string | null };
export type PhoneMessage = {
  id: string; direction: "in" | "out"; kind: string; body: string; status: string; quiet_held: boolean; block_reason: string | null;
  send_after: Date | null; sent_at: Date | null; created_at: Date; display_no: string | null; stage_name: string | null; address: string | null;
};
export type ConsentRecord = { kind: string; method: string; keyword: string | null; consent_text: string | null; at: Date };

export async function phoneOwners(tx: Tx): Promise<PhoneOwner[]> {
  const { rows } = await tx.query(
    `select o.id, o.name, o.phone, o.timezone, o.consent,
       (select c.address from cases c where c.owner_id = o.id order by c.created_at desc limit 1) as address
     from owners o
     order by (select min(c.case_number) from cases c where c.owner_id = o.id) nulls last, o.name`,
  );
  return rows;
}

export async function phoneThread(tx: Tx, ownerId: string): Promise<PhoneMessage[]> {
  const { rows } = await tx.query(
    `select m.id, m.direction, m.kind, m.body, m.status, m.quiet_held, m.block_reason, m.send_after, m.sent_at, m.created_at,
            s.display_no, s.name as stage_name, c.address
     from messages m left join stages s on s.code = m.stage_code left join cases c on c.id = m.case_id
     where m.owner_id = $1 order by m.delivered_seq nulls last, m.seq`,
    [ownerId],
  );
  return rows;
}

export async function consentRecords(tx: Tx, ownerId: string): Promise<ConsentRecord[]> {
  const { rows } = await tx.query(
    "select kind, method, keyword, consent_text, at from consent_events where owner_id = $1 order by at desc",
    [ownerId],
  );
  return rows;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { shortDate } from "@/lib/format";
import { CaseActions, type Action } from "./CaseActions";

export type ListCase = {
  id: string; case_number: string; county: string; address: string; owner_name: string; pending_name: string | null; court_at: Date | null;
};
export type StageGroup = { code: string; display_no: string; name: string; cases: ListCase[]; actions: Action[] };

function Group({ g, now, timezone, readOnly }: { g: StageGroup; now: Date; timezone: string; readOnly: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ids = g.cases.map((c) => c.id);
  const all = picked.size === ids.length && ids.length > 0;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const live = ids.filter((id) => picked.has(id));

  return (
    <section data-testid={`stage-${g.code}`} className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 bg-plum-50 px-4 py-2.5">
        <h2 className="font-serif text-plum-900">
          <span className="mr-2 rounded bg-plum-800 px-1.5 py-0.5 font-sans text-xs font-bold text-white">{g.display_no}</span>
          {g.name} <span className="font-sans text-sm text-muted">({g.cases.length})</span>
        </h2>
        {g.actions.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-semibold text-plum-800">
            <input type="checkbox" data-testid={`select-all-${g.code}`} checked={all} onChange={() => setPicked(all ? new Set() : new Set(ids))} />
            Select all
          </label>
        )}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              {g.actions.length > 0 && <th className="w-8 px-4 py-1.5"><span className="sr-only">Select</span></th>}
              <th className="px-4 py-1.5 font-semibold">Case</th>
              <th className="px-2 py-1.5 font-semibold">Property</th>
              <th className="px-2 py-1.5 font-semibold">Owner</th>
              <th className="px-2 py-1.5 font-semibold">Court</th>
              <th className="px-4 py-1.5 font-semibold">Recorded result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {g.cases.map((c) => (
              <tr key={c.id}>
                {g.actions.length > 0 && (
                  <td className="px-4 py-1.5"><input type="checkbox" aria-label={`Select ${c.case_number}`} checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                )}
                <td className="whitespace-nowrap px-4 py-1.5"><Link className="font-medium text-plum-800 underline-offset-2 hover:underline" href={`/cases/${c.id}`}>{c.case_number}</Link></td>
                <td className="px-2 py-1.5">{c.address}</td>
                <td className="px-2 py-1.5">{c.owner_name}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{c.court_at ? shortDate(c.court_at, timezone) : "None"}</td>
                <td className="px-4 py-1.5 text-muted">{c.pending_name ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {g.actions.length > 0 && (
        <div className="border-t border-line bg-white px-4 py-3">
          <CaseActions compact caseIds={live} stage={g.code} actions={g.actions} now={now} timezone={timezone} disabled={readOnly} />
        </div>
      )}
    </section>
  );
}

export function CasesList({ groups, now, timezone, readOnly }: { groups: StageGroup[]; now: Date; timezone: string; readOnly: boolean }) {
  return <div className="space-y-4">{groups.map((g) => <Group key={g.code} g={g} now={now} timezone={timezone} readOnly={readOnly} />)}</div>;
}

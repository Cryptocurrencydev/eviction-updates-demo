"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputValue } from "@/lib/format";
import { notifyChanged, post } from "./client-api";

export type Action = { to: string; label: string };

const needsDate = (to: string, from: string): { field: string; label: string; days: number; hour: number } | null => {
  if (to === "writ_filed") return { field: "reply_deadline", label: "Owner reply-by deadline", days: 2, hour: 17 };
  if (to === "continued_new_date" && from !== "court_day") return { field: "court_at", label: "New court date and time", days: 7, hour: 9 };
  return null;
};

export function CaseActions({ caseIds, stage, actions, now, timezone, disabled, compact }: {
  caseIds: string[]; stage: string; actions: Action[]; now: Date; timezone: string; disabled?: boolean; compact?: boolean;
}) {
  const router = useRouter();
  const [to, setTo] = useState(actions.length === 1 ? actions[0].to : "");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const need = to ? needsDate(to, stage) : null;
  const dateValue = date || (need ? inputValue(now, timezone, need.days, need.hour) : "");

  if (actions.length === 0) return null;

  async function apply() {
    setBusy(true); setError(""); setNote("");
    try {
      const fields = need ? { [need.field]: dateValue } : {};
      const r = await post("/api/cases/advance", { caseIds, to, fields });
      setNote(r.recorded ? `${r.recorded} recorded. Send the texts from the Court day screen.` : `${r.advanced} moved.`);
      router.refresh();
      notifyChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className={compact ? "flex flex-wrap items-end gap-2" : "space-y-2"}>
      <div>
        <label className="label" htmlFor={`act-${stage}`}>{stage === "court_day" ? "Court result" : "Next step"}</label>
        <select id={`act-${stage}`} data-testid={`action-${stage}`} className="input" value={to} onChange={(e) => { setTo(e.target.value); setDate(""); }}>
          {actions.length > 1 && <option value="">Choose…</option>}
          {actions.map((a) => <option key={a.to} value={a.to}>{a.label}</option>)}
        </select>
      </div>
      {need && (
        <div>
          <label className="label" htmlFor={`date-${stage}`}>{need.label}</label>
          <input id={`date-${stage}`} data-testid={`date-${stage}`} type="datetime-local" className="input" value={dateValue} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      <button data-testid={`apply-${stage}`} className="btn btn-action" disabled={busy || disabled || !to || caseIds.length === 0} onClick={apply}>
        {busy ? "Working…" : compact ? `Apply to ${caseIds.length} selected` : "Apply"}
      </button>
      {note && <p role="status" className="text-sm font-semibold text-good">{note}</p>}
      {error && <p role="alert" data-testid="action-error" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

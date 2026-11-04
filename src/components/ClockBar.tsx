"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clockTime, shortDateTime } from "@/lib/format";
import { notifyChanged, post } from "./client-api";

const STEPS = [
  { hours: 1, label: "+1 hour" },
  { hours: 8, label: "+8 hours" },
  { hours: 24, label: "+1 day" },
  { hours: 168, label: "+7 days" },
];

export function ClockBar({ now, timezone, queued }: { now: Date; timezone: string; queued: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function forward(hours: number) {
    setBusy(true); setNote("");
    try {
      const r = await post("/api/clock", { hours });
      setNote(r.released ? `${r.released} queued text${r.released > 1 ? "s" : ""} released` : "No texts were due");
      router.refresh();
      notifyChanged();
    } catch (e) {
      setNote((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="border-b border-line bg-plum-100 text-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <span>
          <span className="font-semibold text-plum-900">Demo clock:</span>{" "}
          <span data-testid="demo-clock">{shortDateTime(now, timezone)}</span>
          <span className="text-muted"> · Pacific {clockTime(now, "America/Los_Angeles")}</span>
        </span>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fast-forward the demo clock">
          {STEPS.map((s) => (
            <button key={s.hours} disabled={busy} onClick={() => forward(s.hours)} className="rounded-md border border-plum-700/30 bg-white px-2 py-1 text-xs font-semibold text-plum-800 hover:border-plum-700 disabled:opacity-50">
              {s.label}
            </button>
          ))}
        </div>
        <span data-testid="queued-count" className="text-muted">{queued} text{queued === 1 ? "" : "s"} waiting for quiet hours</span>
        {note && <span role="status" className="font-semibold text-plum-800">{note}</span>}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { post } from "./client-api";

export function VerifyButton() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ ok: boolean; checked: number; first_bad_seq: number | null } | null>(null);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true); setError(""); setR(null);
    try { setR(await post("/api/audit/verify")); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button data-testid="verify" className="btn btn-plum" disabled={busy} onClick={run}>{busy ? "Recomputing…" : "Verify log integrity"}</button>
      {r && (
        <span role="status" data-testid="verify-result" className={`text-sm font-semibold ${r.ok ? "text-good" : "text-bad"}`}>
          {r.ok ? `Verified: all ${r.checked} rows match their SHA-256 chain.` : `Chain broken at row ${r.first_bad_seq}.`}
        </span>
      )}
      {error && <span role="alert" className="text-sm text-bad">{error}</span>}
    </div>
  );
}

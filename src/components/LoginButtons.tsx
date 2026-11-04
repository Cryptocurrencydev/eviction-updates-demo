"use client";

import { useState } from "react";
import { post } from "./client-api";

type Login = { email: string; name: string; role: string };
type Firm = { name: string; logins: Login[] };

export function LoginButtons({ firms }: { firms: Firm[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function login(email: string) {
    setBusy(email); setError("");
    try {
      await post("/api/auth/login", { email });
      window.location.href = "/court-day";
    } catch (e) {
      setError((e as Error).message); setBusy(null);
    }
  }
  async function reset() {
    setBusy("reset"); setError(""); setNote("");
    try {
      await post("/api/demo/reset");
      setNote("Both firms are back to the opening scene.");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {firms.map((f) => (
          <section key={f.name} className="card p-4">
            <h2 className="font-serif text-lg text-plum-900">{f.name}</h2>
            <div className="mt-3 space-y-2">
              {f.logins.map((l) => (
                <button key={l.email} disabled={!!busy} onClick={() => login(l.email)} className="btn btn-ghost w-full !justify-between text-left">
                  <span>{l.role === "admin" ? "Firm Admin" : "Team Member"}</span>
                  <span className="font-normal text-muted">{busy === l.email ? "Opening…" : l.name}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button className="btn btn-ghost" disabled={!!busy} onClick={reset}>{busy === "reset" ? "Resetting…" : "Reset demo data"}</button>
        <span className="text-muted">Puts both firms back to the opening scene. The audit log keeps its history.</span>
      </div>
      {note && <p role="status" className="text-sm text-good">{note}</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

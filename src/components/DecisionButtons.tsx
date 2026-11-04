"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./client-api";

export function DecisionButtons({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function choose(choice: "STAY" | "LOCKOUT") {
    setBusy(choice); setError("");
    try {
      await post(`/api/decide/${token}`, { choice });
      router.refresh();
    } catch (e) {
      setError((e as Error).message); setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      <button data-testid="choose-stay" disabled={!!busy} onClick={() => choose("STAY")} className="w-full rounded-xl border-2 border-good-line bg-good-tint p-4 text-left disabled:opacity-60">
        <span className="block text-lg font-bold text-good">{busy === "STAY" ? "Recording…" : "Stay"}</span>
        <span className="text-sm">Accept funds and let the resident stay. The case closes.</span>
      </button>
      <button data-testid="choose-lockout" disabled={!!busy} onClick={() => choose("LOCKOUT")} className="w-full rounded-xl border-2 border-bad-line bg-bad-tint p-4 text-left disabled:opacity-60">
        <span className="block text-lg font-bold text-bad">{busy === "LOCKOUT" ? "Recording…" : "Lockout"}</span>
        <span className="text-sm">Move forward with the lockout.</span>
      </button>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./client-api";

const SCENARIOS = [
  { id: "trial_ending", label: "Trial ending soon" },
  { id: "payment_failed", label: "Payment fails" },
  { id: "grace_over", label: "Grace period ends" },
  { id: "recovered", label: "Payment recovers" },
];

export function BillingPanel({ stripeReady, hasSubscription }: { stripeReady: boolean; hasSubscription: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function go(path: string) {
    setBusy(path); setError("");
    try {
      const { url } = await post(`/api/billing/${path}`);
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message); setBusy("");
    }
  }
  async function simulate(scenario: string) {
    setBusy(scenario); setError("");
    try {
      await post("/api/billing/simulate", { scenario });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="font-serif text-lg text-plum-900">Stripe test mode</h2>
        <p className="mt-1 text-sm text-muted">Real hosted Checkout and customer portal. Test card 4242 4242 4242 4242, any future date, any CVC.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button data-testid="checkout" className="btn btn-action" disabled={!!busy || !stripeReady} onClick={() => go("checkout")}>
            {busy === "checkout" ? "Opening…" : "Start 14-day trial in Checkout"}
          </button>
          <button data-testid="portal" className="btn btn-ghost" disabled={!!busy || !stripeReady || !hasSubscription} onClick={() => go("portal")}>
            {busy === "portal" ? "Opening…" : "Open customer portal"}
          </button>
        </div>
        {!stripeReady && <p className="mt-2 text-sm text-muted">Stripe keys aren't set here, so use the simulator below.</p>}
      </section>
      <section className="card p-4">
        <h2 className="font-serif text-lg text-plum-900">Billing simulator</h2>
        <p className="mt-1 text-sm text-muted">Waiting for a real card to fail takes weeks. These buttons send the same events through the same webhook handler.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button key={s.id} data-testid={`sim-${s.id}`} className="btn btn-ghost" disabled={!!busy} onClick={() => simulate(s.id)}>{busy === s.id ? "Working…" : s.label}</button>
          ))}
        </div>
      </section>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

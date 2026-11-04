"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "./client-api";

export function ContactForm({ phone, email }: { phone: string; email: string }) {
  const router = useRouter();
  const [p, setP] = useState(phone);
  const [e, setE] = useState(email);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function save(ev: React.FormEvent) {
    ev.preventDefault(); setNote(""); setError("");
    try { await post("/api/settings/contact", { phone: p, email: e }); setNote("Saved. HELP replies use these now."); router.refresh(); }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div><label className="label" htmlFor="c-phone">Contact phone</label><input id="c-phone" className="input" value={p} onChange={(x) => setP(x.target.value)} /></div>
      <div><label className="label" htmlFor="c-email">Contact email</label><input id="c-email" className="input" value={e} onChange={(x) => setE(x.target.value)} /></div>
      <button className="btn btn-action">Save</button>
      {note && <p role="status" className="text-sm text-good sm:col-span-3">{note}</p>}
      {error && <p role="alert" className="text-sm text-bad sm:col-span-3">{error}</p>}
    </form>
  );
}

export function TemplateEditor({ stage, label, body, defaultBody }: { stage: string; label: string; body: string; defaultBody: string }) {
  const router = useRouter();
  const [text, setText] = useState(body);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function save(value: string) {
    setBusy(true); setNote(""); setError("");
    try { await post("/api/settings/template", { stage, body: value }); setText(value); setNote("Saved"); router.refresh(); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  return (
    <div data-testid={`template-${stage}`}>
      <label className="label" htmlFor={`t-${stage}`}>{label}</label>
      <textarea id={`t-${stage}`} className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-1 flex items-center gap-2">
        <button className="btn btn-ghost !py-1 !text-xs" disabled={busy || text === body} onClick={() => save(text)}>Save</button>
        {body !== defaultBody && <button className="btn btn-ghost !py-1 !text-xs" disabled={busy} onClick={() => save(defaultBody)}>Restore client's wording</button>}
        {note && <span role="status" className="text-xs text-good">{note}</span>}
        {error && <span role="alert" className="text-xs text-bad">{error}</span>}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONSENT_LABEL, clockTime, shortDate, shortDateTime } from "@/lib/format";
import type { ConsentRecord, PhoneMessage, PhoneOwner } from "@/lib/phone";
import { notifyChanged, post } from "./client-api";

export type PhoneData = {
  owners: PhoneOwner[]; owner: PhoneOwner | null; messages: PhoneMessage[]; consent: ConsentRecord[]; now: string; firmName: string; firmTimezone: string;
};

/** Loads one owner's thread and follows changes made anywhere on the page. */
export function usePhone(onRefresh?: () => void) {
  const [ownerId, setOwnerId] = useState<string | undefined>();
  const [data, setData] = useState<PhoneData | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(ownerId);
  idRef.current = ownerId;

  const load = useCallback(async () => {
    try {
      const qs = idRef.current ? `?owner=${idRef.current}` : "";
      const res = await fetch(`/api/phone${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load, ownerId]);
  useEffect(() => {
    const onChange = (e: Event) => {
      const id = (e as CustomEvent).detail?.ownerId;
      if (id && id !== idRef.current) setOwnerId(id);
      else load();
    };
    window.addEventListener("dl:changed", onChange);
    const t = setInterval(load, 8000);
    return () => { window.removeEventListener("dl:changed", onChange); clearInterval(t); };
  }, [load]);

  return { data, failed, ownerId: data?.owner?.id, setOwnerId, reload: load, onRefresh };
}

const QUICK = ["YES", "STAY", "LOCKOUT", "STOP", "HELP"];

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener" data-testid="decision-link" className="break-all font-semibold text-plum-800 underline">
            {p.replace(/^https?:\/\//, "").slice(0, 34)}…
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Bubble({ m, tz }: { m: PhoneMessage; tz: string }) {
  if (m.direction === "in") {
    return (
      <div className="flex justify-end">
        <p data-testid="bubble-in" className="max-w-[80%] rounded-2xl rounded-br-sm bg-action px-3 py-2 text-sm text-white">{m.body}</p>
      </div>
    );
  }
  const header = m.display_no
    ? `${m.display_no === "AP" || m.display_no === "STAY" ? "" : `${m.display_no} `}${m.stage_name}`.toUpperCase()
    : m.kind === "opt_in" ? "OPT-IN REQUEST" : null;
  return (
    <div data-testid="bubble-out" className="max-w-[88%]">
      {header && <p className="mb-0.5 px-1 text-[10px] font-bold tracking-wide text-plum-700">{header}</p>}
      <p className="whitespace-pre-line rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-line"><Linkified text={m.body} /></p>
      {m.sent_at && <p className="mt-0.5 px-1 text-[10px] text-muted">{shortDate(m.sent_at, tz)}, {clockTime(m.sent_at, tz)}</p>}
    </div>
  );
}

export function PhoneFrame({ phone, compact }: { phone: ReturnType<typeof usePhone>; compact?: boolean }) {
  const { data, failed, setOwnerId, ownerId, reload, onRefresh } = phone;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const owner = data?.owner ?? null;
  const delivered = data?.messages.filter((m) => m.status === "sent" || m.status === "received") ?? [];
  const waiting = data?.messages.filter((m) => m.status === "queued" && m.quiet_held) ?? [];
  const held = data?.messages.filter((m) => m.status === "held_opt_in") ?? [];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [delivered.length, ownerId]);

  async function send(body: string) {
    if (!owner || !body.trim()) return;
    setBusy(true); setError("");
    try {
      await post("/api/phone/reply", { ownerId: owner.id, body });
      setText("");
      await reload();
      notifyChanged();
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section aria-label="Owner's phone" className="mx-auto w-full max-w-[360px]">
      <h2 className="font-serif text-base leading-snug text-plum-900">Owner's Phone, texts from your property management firm</h2>
      <p className="mb-2 text-xs text-muted">Sample only, fictional property and resident</p>
      <label className="label" htmlFor="owner-picker">Viewing owner</label>
      <select id="owner-picker" data-testid="owner-picker" className="input mb-3" value={ownerId ?? ""} onChange={(e) => setOwnerId(e.target.value)}>
        {data?.owners.map((o) => (
          <option key={o.id} value={o.id}>{o.name}{o.address ? `, ${o.address}` : ""}</option>
        ))}
      </select>

      <div className="rounded-[2rem] bg-plum-950 p-2 shadow-lg">
        <div className="overflow-hidden rounded-[1.6rem] bg-plum-50">
          <div className="bg-plum-900 px-4 py-2 text-center text-white">
            <p className="text-sm font-semibold">{data?.firmName ?? "…"}</p>
            {owner && (
              <p data-testid="owner-consent" className="text-[11px] text-plum-100">
                {owner.name} · {CONSENT_LABEL[owner.consent]} · {owner.timezone.split("/")[1].replace("_", " ")} time
              </p>
            )}
          </div>
          <div ref={scroller} data-testid="phone-thread" className={`space-y-3 overflow-y-auto p-3 ${compact ? "h-[380px]" : "h-[460px]"}`}>
            {failed && <p className="text-center text-sm text-bad">Couldn't load this phone. Retrying…</p>}
            {!data && !failed && <p className="text-center text-sm text-muted">Loading texts…</p>}
            {data && !owner && <p className="text-center text-sm text-muted">No owners yet. Upload a CSV to add some.</p>}
            {owner && delivered.length === 0 && <p className="text-center text-sm text-muted">No texts yet.</p>}
            {owner && delivered.map((m) => <Bubble key={m.id} m={m} tz={owner.timezone} />)}
            {owner && waiting.map((m) => (
              <p key={m.id} data-testid="quiet-note" className="rounded-lg bg-warn-tint px-3 py-2 text-center text-xs text-warn">
                Quiet hours: a text is queued until {m.send_after ? clockTime(m.send_after, owner.timezone) : "8:00 AM"} their time
              </p>
            ))}
            {owner && held.length > 0 && (
              <p data-testid="held-note" className="rounded-lg bg-plum-100 px-3 py-2 text-center text-xs text-plum-900">
                {held.length} text{held.length > 1 ? "s" : ""} held until this owner replies YES
              </p>
            )}
          </div>
          <form className="flex gap-1.5 border-t border-line bg-white p-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input aria-label="Type a reply as the owner" data-testid="phone-input" className="input !rounded-full" placeholder="Reply as the owner" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-action !rounded-full" disabled={busy || !text.trim()}>Send</button>
          </form>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Quick replies">
        {QUICK.map((w) => (
          <button key={w} disabled={busy || !owner} onClick={() => send(w)} className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-semibold text-plum-800 hover:border-plum-700 disabled:opacity-50">{w}</button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}

export function FirmLog({ data }: { data: PhoneData | null }) {
  if (!data?.owner) return <div className="card p-6 text-center text-muted">Pick an owner to see the firm's log.</div>;
  const { owner } = data;
  const tz = data.firmTimezone;
  const status = (m: PhoneMessage) => {
    if (m.status === "sent") return { label: "Sent", cls: "text-good" };
    if (m.status === "received") return { label: "Received", cls: "text-plum-800" };
    if (m.status === "held_opt_in") return { label: "Held for opt-in", cls: "text-plum-800" };
    if (m.status === "blocked") return { label: "Blocked: opted out", cls: "text-bad" };
    return { label: `Queued until ${m.send_after ? shortDateTime(m.send_after, tz) : "soon"}`, cls: "text-warn" };
  };
  return (
    <section aria-label="Firm's log" className="min-w-0 space-y-4">
      <div className="card overflow-hidden">
        <div className="bg-plum-900 px-4 py-2 text-white"><h2 className="font-serif">Firm's log for {owner.name}</h2></div>
        {data.messages.length === 0 ? (
          <p className="p-6 text-center text-muted">No messages for this owner yet.</p>
        ) : (
          <ul data-testid="firm-log" className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {[...data.messages].reverse().map((m) => {
              const s = status(m);
              return (
                <li key={m.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap justify-between gap-x-3 text-xs">
                    <span className={`font-semibold ${s.cls}`}>{m.direction === "in" ? "Owner replied" : "To owner"} · {s.label}</span>
                    <span className="text-muted">{shortDateTime(m.sent_at ?? m.created_at, tz)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-line [overflow-wrap:anywhere]">{m.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="card p-4">
        <h3 className="font-serif text-plum-900">Consent record</h3>
        <p className="text-sm text-muted">{owner.phone} · {CONSENT_LABEL[owner.consent]}</p>
        {data.consent.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No reply on file yet.</p>
        ) : (
          <ul data-testid="consent-record" className="mt-2 space-y-2 text-sm">
            {data.consent.map((c, i) => (
              <li key={i} className="rounded-md bg-plum-50 p-2">
                <p className="font-semibold">{c.kind === "opt_out" ? "Opted out" : c.kind === "re_opt_in" ? "Opted back in" : "Opted in"} · replied {c.keyword} by text · {shortDateTime(c.at, tz)}</p>
                {c.consent_text && <p className="mt-1 text-muted">Agreed to: "{c.consent_text}"</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

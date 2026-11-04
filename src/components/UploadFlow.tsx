"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CsvPreview } from "@/lib/csv";
import { notifyChanged, post } from "./client-api";

export function UploadFlow({ readOnly }: { readOnly: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setError(""); setDone(null); setPreview(null);
    try {
      const text = await f.text();
      setFile({ name: f.name, text });
      setPreview(await post<CsvPreview>("/api/csv/preview", { text }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function commit() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const r = await post("/api/csv/commit", { text: file.text, filename: file.name });
      setDone(r); setPreview(null); setFile(null);
      if (input.current) input.current.value = "";
      router.refresh(); notifyChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <label className="btn btn-action cursor-pointer">
          Choose a CSV
          <input ref={input} data-testid="csv-input" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <a className="btn btn-ghost" data-testid="sample-link" href="/api/csv/sample">Download sample CSV (25 good, 3 bad)</a>
        {busy && <span role="status" className="text-sm text-muted">Working…</span>}
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {done && (
        <div role="status" data-testid="upload-done" className="rounded-xl border border-good-line bg-good-tint p-4 text-sm">
          <strong>{done.created} cases added at Filed.</strong> {done.skipped} rows skipped. Each new owner gets one opt-in request, and their filing text waits for YES.
        </div>
      )}
      {preview?.fileError && <p role="alert" className="rounded-lg bg-bad-tint p-3 text-sm text-bad">{preview.fileError}</p>}
      {preview && !preview.fileError && (
        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 bg-plum-50 px-4 py-3">
            <p data-testid="preview-summary" className="font-semibold">{preview.valid} rows ready, {preview.invalid} with errors</p>
            <button data-testid="commit" className="btn btn-action" disabled={busy || readOnly || preview.valid === 0} onClick={commit}>
              Add the {preview.valid} valid rows
            </button>
          </header>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-muted">
                <tr><th className="px-4 py-2">Row</th><th className="px-2 py-2">Case</th><th className="px-2 py-2">Property</th><th className="px-2 py-2">Owner</th><th className="px-4 py-2">Check</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...preview.rows].sort((a, b) => b.errors.length - a.errors.length).map((r) => (
                  <tr key={r.line} data-testid={r.errors.length ? "row-bad" : "row-good"} className={r.errors.length ? "bg-bad-tint" : ""}>
                    <td className="px-4 py-1.5">{r.line}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.row.caseNumber || <em className="text-muted">blank</em>}</td>
                    <td className="px-2 py-1.5">{r.row.address}</td>
                    <td className="px-2 py-1.5">{r.row.ownerName}</td>
                    <td className="px-4 py-1.5">{r.errors.length ? <ul className="text-bad">{r.errors.map((e) => <li key={e.message}>{e.message}</li>)}</ul> : <span className="text-good">Ready</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

"use client";

export async function post<T = any>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "Something went wrong. Please try again.");
  return data;
}

/** Tells the phone panels something changed, and optionally whose phone to show. */
export function notifyChanged(ownerId?: string) {
  window.dispatchEvent(new CustomEvent("dl:changed", { detail: { ownerId } }));
}

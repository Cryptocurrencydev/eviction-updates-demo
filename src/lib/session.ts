import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { FirmCtx } from "./db";
import { appSecret } from "./secret";

const COOKIE = "dl_session";
export type Session = { userId: string; firmId: string; role: "admin" | "team"; name: string; email: string };

const sign = (data: string) => createHmac("sha256", appSecret()).update(`session:${data}`).digest("base64url");

export function encodeSession(s: Session) {
  const data = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  const [data, sig] = value.split(".");
  if (!data || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(data));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return JSON.parse(Buffer.from(data, "base64url").toString());
}

export async function getSession() {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/");
  return s;
}

export async function setSession(s: Session) {
  (await cookies()).set(COOKIE, encodeSession(s), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && !process.env.PLAYWRIGHT_LOCAL, path: "/", maxAge: 60 * 60 * 12 });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export const ctxOf = (s: Session): FirmCtx => ({ firmId: s.firmId, role: s.role, actor: `${s.name} (${s.role === "admin" ? "Firm Admin" : "Team Member"})` });

import "server-only";
import { NextResponse } from "next/server";
import type { FirmCtx } from "./db";
import { ctxOf, getSession, type Session } from "./session";

const STATUS: Record<string, number> = { DL001: 422, DL002: 422, DL003: 423, DL404: 404 };
const CODES: Record<string, string> = { DL001: "invalid_transition", DL002: "missing_field", DL003: "read_only", DL404: "not_found" };

export function apiError(e: unknown) {
  const err = e as { code?: string; message?: string };
  const status = err.code ? STATUS[err.code] : undefined;
  if (status) return NextResponse.json({ error: CODES[err.code!], message: err.message }, { status });
  // RLS write refusal: 42501 is insufficient_privilege.
  if (err.code === "42501") return NextResponse.json({ error: "forbidden", message: "Not allowed for this role." }, { status: 403 });
  console.error(e);
  return NextResponse.json({ error: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
}

type Handler = (ctx: FirmCtx, session: Session, req: Request) => Promise<Response | unknown>;

/** Session, role check and error mapping for firm API routes. */
export function firmRoute(handler: Handler, opts: { admin?: boolean } = {}) {
  return async (req: Request) => {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "unauthorized", message: "Please log in." }, { status: 401 });
    if (opts.admin && session.role !== "admin") {
      return NextResponse.json({ error: "forbidden", message: "Only a Firm Admin can do this." }, { status: 403 });
    }
    try {
      const out = await handler(ctxOf(session), session, req);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return apiError(e);
    }
  };
}

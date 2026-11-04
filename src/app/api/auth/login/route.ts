import { NextResponse } from "next/server";
import { withSystem } from "@/lib/db";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  const { email } = await req.json();
  const { rows } = await withSystem((tx) => tx.query("select id, firm_id, role, name, email from users where email = $1", [email]));
  const u = rows[0];
  if (!u) return NextResponse.json({ error: "unknown_user", message: "That demo login doesn't exist yet." }, { status: 404 });
  await setSession({ userId: u.id, firmId: u.firm_id, role: u.role, name: u.name, email: u.email });
  return NextResponse.json({ ok: true });
}

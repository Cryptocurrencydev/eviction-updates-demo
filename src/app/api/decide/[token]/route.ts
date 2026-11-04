import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { decideByLink } from "@/lib/decision";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { choice } = await req.json();
  if (choice !== "STAY" && choice !== "LOCKOUT") return NextResponse.json({ error: "bad_choice" }, { status: 400 });
  try {
    return NextResponse.json(await decideByLink(token, choice));
  } catch (e) {
    return apiError(e);
  }
}

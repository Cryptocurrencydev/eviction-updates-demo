import { withSystem } from "@/lib/db";
import { handleInbound } from "@/lib/messaging/inbound";
import { isValidTwilioRequest } from "@/lib/messaging/twilio-sender";
import { appUrl } from "@/lib/secret";

const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Real inbound webhook. Unused by the demo; answers 503 until a Twilio token is configured. */
export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("not configured", { status: 503 });

  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!isValidTwilioRequest(token, signature, `${appUrl()}/api/twilio/inbound`, params)) {
    return new Response("invalid signature", { status: 403 });
  }

  const { rows } = await withSystem((tx) => tx.query("select id from firms where sms_number = $1", [params.To]));
  if (rows[0]) await handleInbound(rows[0].id, params.From, params.Body ?? "");
  return new Response(TWIML, { headers: { "content-type": "text/xml" } });
}

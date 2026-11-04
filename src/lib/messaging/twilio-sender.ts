import twilio from "twilio";
import type { MessageSender, OutboundSms } from "./sender";

/** Real Twilio implementation. Never called in the demo: it needs MESSAGE_SENDER=twilio and A2P 10DLC registration. */
export class TwilioSender implements MessageSender {
  readonly name = "twilio";
  private client: ReturnType<typeof twilio>;

  constructor(accountSid: string, authToken: string) {
    this.client = twilio(accountSid, authToken);
  }

  async send({ to, from, body }: OutboundSms) {
    const msg = await this.client.messages.create({ to, from, body });
    return { providerId: msg.sid };
  }
}

/** Checks X-Twilio-Signature against the full public URL and the POSTed form fields. */
export function isValidTwilioRequest(authToken: string, signature: string, url: string, params: Record<string, string>) {
  return twilio.validateRequest(authToken, signature, url, params);
}

import type { MessageSender } from "./sender";
import { SimulatedSender } from "./simulated-sender";
import { TwilioSender } from "./twilio-sender";

export function getSender(): MessageSender {
  if (process.env.MESSAGE_SENDER === "twilio") {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = process.env;
    if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
    return new TwilioSender(sid, token);
  }
  return new SimulatedSender();
}

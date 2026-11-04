import { randomUUID } from "node:crypto";
import type { MessageSender, OutboundSms } from "./sender";

/** Used by the demo. Delivers to the on-screen phone by way of the messages table. */
export class SimulatedSender implements MessageSender {
  readonly name = "simulated";
  async send(_sms: OutboundSms) {
    return { providerId: `sim_${randomUUID()}` };
  }
}

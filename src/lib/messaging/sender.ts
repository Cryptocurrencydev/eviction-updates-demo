export type OutboundSms = { to: string; from: string; body: string };

/** Everything that sends a text goes through this, so going live is a one-line switch. */
export interface MessageSender {
  readonly name: string;
  send(sms: OutboundSms): Promise<{ providerId: string }>;
}

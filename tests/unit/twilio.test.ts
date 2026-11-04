import { describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import { getSender } from "@/lib/messaging";
import { isValidTwilioRequest } from "@/lib/messaging/twilio-sender";

const TOKEN = "test-auth-token";
const URL = "https://example.test/api/twilio/inbound";
const params = { From: "+19195550101", To: "+19195550100", Body: "STOP" };

describe("twilio", () => {
  it("accepts a real signature", () => {
    const sig = twilio.getExpectedTwilioSignature(TOKEN, URL, params);
    expect(isValidTwilioRequest(TOKEN, sig, URL, params)).toBe(true);
  });
  it("rejects a forged signature or changed body", () => {
    const sig = twilio.getExpectedTwilioSignature(TOKEN, URL, params);
    expect(isValidTwilioRequest(TOKEN, "forged", URL, params)).toBe(false);
    expect(isValidTwilioRequest(TOKEN, sig, URL, { ...params, Body: "YES" })).toBe(false);
  });
  it("the demo uses the simulated sender by default", () => {
    expect(getSender().name).toBe("simulated");
  });
  it("switches to Twilio only when configured", () => {
    vi.stubEnv("MESSAGE_SENDER", "twilio");
    expect(() => getSender()).toThrow(/TWILIO_ACCOUNT_SID/);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
    expect(getSender().name).toBe("twilio");
    vi.unstubAllEnvs();
  });
});

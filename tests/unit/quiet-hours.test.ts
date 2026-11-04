import { describe, expect, it } from "vitest";
import { isWithinSendWindow, nextSendTime } from "@/lib/messaging/quiet-hours";

const NY = "America/New_York", LA = "America/Los_Angeles";
const iso = (d: Date) => d.toISOString();

describe("quiet hours", () => {
  it("allows 8:00am and blocks 7:59am in the owner's zone", () => {
    expect(isWithinSendWindow(new Date("2026-06-15T12:00:00Z"), NY)).toBe(true);
    expect(isWithinSendWindow(new Date("2026-06-15T11:59:00Z"), NY)).toBe(false);
  });
  it("allows 8:59pm and blocks 9:00pm", () => {
    expect(isWithinSendWindow(new Date("2026-06-16T00:59:00Z"), NY)).toBe(true);
    expect(isWithinSendWindow(new Date("2026-06-16T01:00:00Z"), NY)).toBe(false);
  });
  it("10am Eastern is quiet for a Pacific owner", () => {
    const at = new Date("2026-06-15T13:30:00Z"); // 9:30am ET, 6:30am PT
    expect(isWithinSendWindow(at, NY)).toBe(true);
    expect(isWithinSendWindow(at, LA)).toBe(false);
    expect(iso(nextSendTime(at, LA))).toBe("2026-06-15T15:00:00.000Z"); // 8am PDT
  });
  it("after 9pm rolls to 8am the next local day", () => {
    expect(iso(nextSendTime(new Date("2026-06-16T02:00:00Z"), NY))).toBe("2026-06-16T12:00:00.000Z");
  });
  it("a late Pacific evening is already the next UTC day, and still rolls correctly", () => {
    // 10pm PDT on Jun 15 is 05:00Z on Jun 16
    expect(iso(nextSendTime(new Date("2026-06-16T05:00:00Z"), LA))).toBe("2026-06-16T15:00:00.000Z");
  });
  it("spring forward: 8am Eastern is 12:00Z after the change, not 13:00Z", () => {
    // Clocks change at 2am on Sun Mar 8 2026. 1am EST is 06:00Z.
    expect(iso(nextSendTime(new Date("2026-03-08T06:00:00Z"), NY))).toBe("2026-03-08T12:00:00.000Z");
  });
  it("fall back: 8am Eastern is 13:00Z after the change", () => {
    // Clocks change at 2am on Sun Nov 1 2026. 1:30am EDT is 05:30Z.
    expect(iso(nextSendTime(new Date("2026-11-01T05:30:00Z"), NY))).toBe("2026-11-01T13:00:00.000Z");
  });
  it("the night before a change uses the new offset for the next morning", () => {
    // 10pm PST Sat Mar 7 -> 8am PDT Sun Mar 8 = 15:00Z
    expect(iso(nextSendTime(new Date("2026-03-08T06:00:00Z"), LA))).toBe("2026-03-08T15:00:00.000Z");
  });
  it("returns the same instant when sending is allowed", () => {
    const at = new Date("2026-06-15T15:00:00Z");
    expect(nextSendTime(at, NY)).toBe(at);
  });
});

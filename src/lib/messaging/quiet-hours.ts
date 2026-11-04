import { DateTime } from "luxon";

export const SEND_START_HOUR = 8;
export const SEND_END_HOUR = 21;

/** True when `at` falls between 8:00am and 8:59:59pm on the owner's own clock. */
export function isWithinSendWindow(at: Date, timezone: string): boolean {
  const hour = DateTime.fromJSDate(at).setZone(timezone).hour;
  return hour >= SEND_START_HOUR && hour < SEND_END_HOUR;
}

/** `at` if sending is allowed now, otherwise the next 8:00am in the owner's zone. */
export function nextSendTime(at: Date, timezone: string): Date {
  if (isWithinSendWindow(at, timezone)) return at;
  const local = DateTime.fromJSDate(at).setZone(timezone);
  const day = local.hour >= SEND_END_HOUR ? local.plus({ days: 1 }) : local;
  return day.set({ hour: SEND_START_HOUR, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

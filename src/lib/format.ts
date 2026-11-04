import { DateTime } from "luxon";

const z = (d: Date | string, tz: string) => DateTime.fromJSDate(new Date(d)).setZone(tz).setLocale("en-US");
export const shortDate = (d: Date | string, tz: string) => z(d, tz).toFormat("ccc, LLL d");
export const shortDateTime = (d: Date | string, tz: string) => z(d, tz).toFormat("ccc, LLL d, h:mm a ZZZZ");
export const clockTime = (d: Date | string, tz: string) => z(d, tz).toFormat("h:mm a ZZZZ");
export const inputValue = (d: Date | string, tz: string, days = 0, hour?: number) => {
  let v = z(d, tz).plus({ days });
  if (hour != null) v = v.set({ hour, minute: 0 });
  return v.toFormat("yyyy-LL-dd'T'HH:mm");
};
export const CONSENT_LABEL: Record<string, string> = {
  none: "Not asked", pending: "Opt-in pending", opted_in: "Opted in", opted_out: "Opted out",
};

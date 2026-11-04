import { DateTime } from "luxon";

export const PLACEHOLDERS = ["address", "day", "time", "deadline"] as const;

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

export function unknownPlaceholders(body: string): string[] {
  return [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
}

const local = (d: Date, tz: string) => DateTime.fromJSDate(d).setZone(tz).setLocale("en-US");
export const fmtDay = (d: Date, tz: string) => local(d, tz).toFormat("cccc, LLLL d");
export const fmtTime = (d: Date, tz: string) => local(d, tz).toFormat("h:mm a ZZZZ");
export const fmtDateTime = (d: Date, tz: string) => `${fmtDay(d, tz)} at ${fmtTime(d, tz)}`;

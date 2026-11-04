export type Firm = {
  id: string; slug: string; name: string; sms_number: string; timezone: string; demo_now: Date;
  contact_phone: string; contact_email: string; lockout_lead_days: number;
};
export type Owner = {
  id: string; firm_id: string; name: string; phone: string; timezone: string;
  consent: "none" | "pending" | "opted_in" | "opted_out"; opt_in_requested_at: Date | null;
};
export type CaseRow = {
  id: string; firm_id: string; owner_id: string; case_number: string; county: string; filing_date: Date;
  address: string; resident_name: string; stage: string; pending_stage: string | null; paused_from: string | null;
  court_at: Date | null; possession_at: Date | null; writ_filed_at: Date | null; reply_deadline: Date | null;
  lockout_at: Date | null; keys_held_until: Date | null; closed_at: Date | null; stage_changed_at: Date;
};
export type Stage = {
  code: string; display_no: string; name: string; tone: "neutral" | "good" | "bad" | "warn";
  sort: number; is_terminal: boolean; sends_text: boolean; default_template: string | null;
};

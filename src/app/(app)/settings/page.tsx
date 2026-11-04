import { ContactForm, TemplateEditor } from "@/components/SettingsForms";
import { withFirm } from "@/lib/db";
import { loadFirm } from "@/lib/messaging/outbox";
import { PLACEHOLDERS } from "@/lib/messaging/render";
import { ctxOf, requireSession } from "@/lib/session";

export default async function SettingsPage() {
  const s = await requireSession();
  if (s.role !== "admin") {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="font-serif text-xl text-plum-900">Firm Admins only</h1>
        <p className="mt-1 text-sm text-muted">Team Members can't change team settings or text templates.</p>
      </div>
    );
  }
  const { firm, team, stages } = await withFirm(ctxOf(s), async (tx) => ({
    firm: await loadFirm(tx),
    team: (await tx.query("select name, email, role from users order by role, name")).rows,
    stages: (await tx.query(
      `select s.code, s.display_no, s.name, s.default_template, coalesce(t.body, s.default_template) as body
       from stages s left join templates t on t.stage_code = s.code where s.sends_text order by s.sort`,
    )).rows,
  }));
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="font-serif text-2xl text-plum-900">Settings</h1>
      <section className="card p-4">
        <h2 className="font-serif text-lg text-plum-900">Team</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {team.map((u) => (
            <li key={u.email} className="flex justify-between py-1.5"><span>{u.name} <span className="text-muted">{u.email}</span></span><span>{u.role === "admin" ? "Firm Admin" : "Team Member"}</span></li>
          ))}
        </ul>
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-serif text-lg text-plum-900">Firm contact, used in HELP replies</h2>
        <ContactForm phone={firm.contact_phone} email={firm.contact_email} />
      </section>
      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-serif text-lg text-plum-900">Owner text templates</h2>
          <p className="text-sm text-muted">Placeholders: {PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}. Court Day has no owner text. The writ text gets the one-click link added automatically.</p>
          <p className="demo-note">Lockout date default of {firm.lockout_lead_days} days after the owner's reply is a demo value, to be confirmed against the client's scope sheet.</p>
        </div>
        {stages.map((st) => (
          <TemplateEditor key={st.code} stage={st.code} label={`${st.display_no} ${st.name}`} body={st.body} defaultBody={st.default_template} />
        ))}
      </section>
    </div>
  );
}

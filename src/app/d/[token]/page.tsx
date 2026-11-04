import { DecisionButtons } from "@/components/DecisionButtons";
import { linkState } from "@/lib/decision";
import { shortDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your decision", referrer: "no-referrer" as const };

function Message({ title, children, testid }: { title: string; children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid}>
      <h1 className="font-serif text-2xl text-plum-900">{title}</h1>
      <div className="mt-2 space-y-2 text-ink">{children}</div>
    </div>
  );
}

export default async function DecisionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await linkState(token);
  const firm = s.state === "invalid" ? "Docketlight" : s.firmName;
  return (
    <>
      <header className="bg-plum-900 px-4 py-4 text-white">
        <p className="mx-auto max-w-md font-serif text-lg">{firm}</p>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        {s.state === "ready" && (
          <>
            <h1 className="font-serif text-2xl text-plum-900">The writ was filed. What would you like to do?</h1>
            <p className="mt-1 font-semibold">{s.address}</p>
            <p className="mb-4 text-sm text-muted">Please choose by {shortDateTime(s.deadline, s.timezone)}. No login needed, and this link works once.</p>
            <DecisionButtons token={token} />
          </>
        )}
        {s.state === "already" && (
          <Message testid="already-recorded" title="Already recorded">
            <p>We have your choice for {s.address}: <strong>{s.choice === "STAY" ? "Stay, accept funds" : "Lockout"}</strong>.</p>
            <p className="text-sm text-muted">Recorded {shortDateTime(s.decidedAt, s.timezone)} by {s.channel === "sms" ? "text reply" : "this link"}. To change it, call {s.firmName} at {s.firmPhone}.</p>
          </Message>
        )}
        {s.state === "expired" && (
          <Message testid="link-expired" title="This link has expired">
            <p>Reply STAY or LOCKOUT to our text, or call {s.firmName} at {s.firmPhone}.</p>
          </Message>
        )}
        {s.state === "paused" && (
          <Message testid="link-paused" title="This case is paused">
            <p>An appeal was filed for {s.address}, so no decision is needed right now. We will text you when it resumes.</p>
          </Message>
        )}
        {s.state === "unavailable" && (
          <Message testid="link-unavailable" title="We can't take this online right now">
            <p>Please call {s.firmName} at {s.firmPhone}.</p>
          </Message>
        )}
        {s.state === "invalid" && (
          <Message testid="link-invalid" title="This link isn't valid">
            <p>Please use the link in your text message, or call your property management firm.</p>
          </Message>
        )}
        <p className="mt-8 text-center text-xs text-muted">Sample only, fictional property and resident</p>
      </main>
    </>
  );
}

import { LoginButtons } from "@/components/LoginButtons";
import { DEMO_FIRMS } from "@/lib/seed";

export default function LoginPage() {
  const firms = DEMO_FIRMS.map((f) => ({ name: f.name, logins: f.users.map((u) => ({ email: u.email, name: u.name, role: u.role })) }));
  return (
    <>
      <header className="bg-plum-900 px-4 py-10 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="font-serif text-3xl">Docketlight</p>
          <p className="mt-2 max-w-xl text-plum-100">
            Owners get a plain text at every step of their eviction case, while your team works from one court day screen.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-1 font-serif text-xl text-plum-900">Choose a demo login</h1>
        <p className="mb-5 text-sm text-muted">
          One click, no password. Switch firms to see that each one only sees its own cases. All firms, owners, residents and addresses are fictional.
        </p>
        <LoginButtons firms={firms} />
      </main>
    </>
  );
}

"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="font-serif text-2xl text-plum-900">That page didn't load</h1>
      <p className="mt-2 text-muted">Nothing was changed. Try again, or go back to the login page.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button className="btn btn-action" onClick={reset}>Try again</button>
        <a className="btn btn-ghost" href="/">Back to login</a>
      </div>
    </main>
  );
}

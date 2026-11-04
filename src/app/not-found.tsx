export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="font-serif text-2xl text-plum-900">Page not found</h1>
      <p className="mt-2 text-muted">This firm may not have that case, or the page has moved.</p>
      <a className="btn btn-action mt-6" href="/court-day">Back to court day</a>
    </main>
  );
}

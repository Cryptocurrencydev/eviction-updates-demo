export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse space-y-3">
      <div className="h-16 rounded-lg bg-plum-100" />
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-36 rounded-lg bg-plum-50" />)}
      </div>
    </div>
  );
}

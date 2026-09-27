export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="skeleton h-8 w-64" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-9 w-24 rounded-full" />)}
      </div>
      <div className="overflow-hidden rounded-2xl border border-line">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line/60 px-5 py-4 last:border-0">
            <div className="skeleton h-6 w-20" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/3" />
            </div>
            <div className="skeleton hidden h-9 w-9 rounded-full sm:block" />
            <div className="skeleton h-6 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

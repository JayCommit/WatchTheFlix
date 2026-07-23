export function AdminSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="admin-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="admin-skeleton-row" />
      ))}
    </div>
  )
}

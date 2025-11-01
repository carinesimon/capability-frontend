export default function StatCard({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-[--muted]">{title}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-[--muted]">{hint}</div>}
    </div>
  );
  
}

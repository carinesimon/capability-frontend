"use client";

type Col<T> = { key: keyof T; label: string; fmt?: (v:any,row:T)=>React.ReactNode };
type Order = "asc" | "desc";

export default function RankingTable<T extends Record<string, any>>({
  title, rows, columns, sortBy, order="desc", top=3, onSort,
}:{
  title: string;
  rows: T[];
  columns: Col<T>[];
  sortBy: keyof T;
  order?: Order;
  top?: number;
  onSort?: (key: keyof T) => void;
}){

  return (
    <div className="card overflow-x-auto">
      <div className="text-sm text-[--muted] mb-2">{title}</div>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            {columns.map(c=>(
              <th key={String(c.key)}>
                <button onClick={()=>onSort?.(c.key)} className="hover:underline">{c.label}{sortBy===c.key ? (order==="asc"?" ↑":" ↓") : ""}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length===0 ? (
            <tr><td className="text-[--muted]" colSpan={columns.length+1}>Aucune donnée.</td></tr>
          ) : rows.map((r,i)=>(
            <tr key={i}>
              <td>
                {i<top ? <span className="px-2 py-0.5 text-[10px] rounded-full bg-white/15">TOP</span> : i+1}
              </td>
              {columns.map(c=>(
                <td key={String(c.key)}>{c.fmt ? c.fmt(r[c.key], r) : String(r[c.key] ?? "—")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

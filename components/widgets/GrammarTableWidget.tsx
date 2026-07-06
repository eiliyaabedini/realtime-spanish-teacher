import type { GrammarTable } from "@/lib/practice/widgets";

export function GrammarTableWidget({ table }: { table: GrammarTable }) {
  return (
    <div className="bubble-in w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-warm">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">Grammar</p>
      <p className="font-display mt-1 text-lg font-semibold tracking-tight">{table.title}</p>

      {table.formula && (
        <p className="mt-3 rounded-xl bg-[#3C3489]/10 p-3 font-mono text-[13px] leading-relaxed">
          {table.formula}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {table.columns.map((col, i) => (
                <th
                  key={i}
                  className="border-b-2 border-line px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="border-b border-line/60 last:border-0">
                {row.map((cell, c) => (
                  <td key={c} className={`px-3 py-2 ${c === 0 ? "text-muted" : "font-medium"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.note && <p className="mt-3 text-sm italic text-muted">{table.note}</p>}
    </div>
  );
}

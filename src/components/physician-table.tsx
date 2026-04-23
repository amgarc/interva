import Link from "next/link";
import type { Physician, PhysicianAddress, PhysicianTaxonomy } from "@prisma/client";

type PhysicianWithRelations = Physician & {
  taxonomies: PhysicianTaxonomy[];
  addresses: PhysicianAddress[];
};

// Note: Physician already carries isActiveIr / totalIrServices / distinctIrCpts
// / lastIrBillingYear after the active-IR derivation, so no extra include needed.

export function PhysicianTable({ rows }: { rows: PhysicianWithRelations[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-black/10 dark:border-white/10 rounded p-8 text-center opacity-70">
        No physicians match these filters.
      </div>
    );
  }

  return (
    <div className="border border-black/10 dark:border-white/10 rounded overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.03] dark:bg-white/[0.03] text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">NPI</th>
            <th className="px-3 py-2 font-medium">Primary taxonomy</th>
            <th className="px-3 py-2 font-medium">Practice location</th>
            <th className="px-3 py-2 font-medium">Phone</th>
            <th className="px-3 py-2 font-medium text-right" title="Total IR Tier-1 services billed to Medicare in 2023">IR svcs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const name = [p.firstName, p.middleName, p.lastName]
              .filter(Boolean)
              .join(" ") || "(no name)";
            const credentials = p.credentials ? `, ${p.credentials}` : "";
            const primary = p.taxonomies.find((t) => t.isPrimary) ?? p.taxonomies[0];
            const practice =
              p.addresses.find((a) => a.kind === "practice") ??
              p.addresses.find((a) => a.kind === "mailing");

            return (
              <tr
                key={p.npi}
                className="border-t border-black/5 dark:border-white/5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              >
                <td className="px-3 py-2">
                  <Link href={`/physicians/${p.npi}`} className="hover:underline">
                    {name}
                    <span className="opacity-60">{credentials}</span>
                  </Link>
                  {p.isActiveIr && (
                    <span
                      className="ml-2 text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      title={`Billed ${p.totalIrServices?.toLocaleString() ?? 0} IR Tier-1 services in ${p.lastIrBillingYear}`}
                    >
                      active IR
                    </span>
                  )}
                  {p.deactivationDate && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-700 dark:text-red-300">
                      deactivated
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs opacity-80">{p.npi}</td>
                <td className="px-3 py-2 text-xs">
                  {primary ? (
                    <span title={primary.code}>{primary.name ?? primary.code}</span>
                  ) : (
                    <span className="opacity-40">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {practice ? (
                    <>
                      {practice.city ?? "—"}, {practice.state ?? "—"}
                    </>
                  ) : (
                    <span className="opacity-40">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs font-mono">
                  {practice?.phone ? formatPhone(practice.phone) : <span className="opacity-40">—</span>}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums">
                  {p.totalIrServices != null ? (
                    <span title={`${p.distinctIrCpts} distinct CPTs`}>{p.totalIrServices.toLocaleString()}</span>
                  ) : (
                    <span className="opacity-40">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

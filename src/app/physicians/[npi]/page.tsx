import Link from "next/link";
import { notFound } from "next/navigation";
import { getPhysicianByNpi } from "@/lib/physicians";

export const dynamic = "force-dynamic";

function formatPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

export default async function PhysicianDetailPage({
  params,
}: {
  params: Promise<{ npi: string }>;
}) {
  const { npi } = await params;
  const p = await getPhysicianByNpi(npi);
  if (!p) notFound();

  const fullName = [p.namePrefix, p.firstName, p.middleName, p.lastName, p.nameSuffix]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="max-w-4xl">
      <Link href="/" className="text-sm opacity-70 hover:opacity-100">
        ← Back to list
      </Link>

      <div className="mt-2 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">
          {fullName}
          {p.credentials && <span className="opacity-60 font-normal">, {p.credentials}</span>}
        </h1>
        <div className="flex gap-2 flex-wrap justify-end">
          {p.isActiveIr && (
            <span className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              active IR
            </span>
          )}
          {p.practiceSetting === "OBL" && (
            <span
              className="text-xs px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300"
              title="Majority of IR services billed as office-based (POS=O)"
            >
              OBL
            </span>
          )}
          {p.practiceSetting === "FACILITY" && (
            <span className="text-xs px-2 py-1 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
              facility
            </span>
          )}
          {p.practiceSetting === "MIXED" && (
            <span className="text-xs px-2 py-1 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300">
              mixed setting
            </span>
          )}
          {p.deactivationDate && (
            <span className="text-xs px-2 py-1 rounded bg-red-500/15 text-red-700 dark:text-red-300">
              deactivated {p.deactivationDate.toISOString().slice(0, 10)}
            </span>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-[160px_1fr] gap-y-1 text-sm">
        <dt className="opacity-60">NPI</dt>
        <dd className="font-mono">{p.npi}</dd>
        <dt className="opacity-60">Sex</dt>
        <dd>{p.gender ?? "—"}</dd>
        <dt className="opacity-60">Enumerated</dt>
        <dd>{p.enumerationDate?.toISOString().slice(0, 10) ?? "—"}</dd>
        <dt className="opacity-60">Last updated</dt>
        <dd>{p.lastUpdatedDate?.toISOString().slice(0, 10) ?? "—"}</dd>
        <dt className="opacity-60">Sole proprietor</dt>
        <dd>{p.soleProprietor ?? "—"}</dd>
      </dl>

      {p.lastIrBillingYear != null && (
        <Section title={`Medicare IR activity (${p.lastIrBillingYear})`}>
          <div className="grid grid-cols-[160px_1fr] gap-y-1 text-sm mb-3">
            <dt className="opacity-60">Total services</dt>
            <dd>
              {p.totalIrServices?.toLocaleString() ?? "—"}{" "}
              <span className="opacity-60 text-xs">
                ({p.totalIrBenes?.toLocaleString() ?? "—"} beneficiaries)
              </span>
            </dd>
            <dt className="opacity-60">Distinct IR CPTs</dt>
            <dd>{p.distinctIrCpts ?? "—"}</dd>
            <dt className="opacity-60">Subspecialty mix</dt>
            <dd>{p.activeIrCategories.length > 0 ? p.activeIrCategories.join(" · ") : "—"}</dd>
            <dt className="opacity-60">Practice setting</dt>
            <dd>
              {p.practiceSetting ?? "—"}
              {p.irOfficeServices != null && p.irFacilityServices != null && (
                <span className="opacity-60 text-xs ml-2">
                  ({p.irOfficeServices.toLocaleString()} office / {p.irFacilityServices.toLocaleString()} facility)
                </span>
              )}
            </dd>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left opacity-70">
              <tr>
                <th className="py-1 pr-3">CPT</th>
                <th className="py-1 pr-3">Category</th>
                <th className="py-1 pr-3">POS</th>
                <th className="py-1 pr-3 text-right">Services</th>
                <th className="py-1 text-right">Beneficiaries</th>
              </tr>
            </thead>
            <tbody>
              {p.procedures.map((pv) => (
                <tr key={pv.id} className="border-t border-black/5 dark:border-white/5">
                  <td className="py-1 pr-3 font-mono text-xs">{pv.cpt}</td>
                  <td className="py-1 pr-3 text-xs">{pv.category}</td>
                  <td className="py-1 pr-3 text-xs">{pv.placeOfService ?? "—"}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{pv.totServices.toLocaleString()}</td>
                  <td className="py-1 text-right tabular-nums">
                    {pv.totBenes != null ? pv.totBenes.toLocaleString() : <span className="opacity-50">sup.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Taxonomies">
        <table className="w-full text-sm">
          <thead className="text-left opacity-70">
            <tr>
              <th className="py-1 pr-3">Slot</th>
              <th className="py-1 pr-3">Code</th>
              <th className="py-1 pr-3">Name</th>
              <th className="py-1 pr-3">Primary</th>
              <th className="py-1 pr-3">License</th>
              <th className="py-1">State</th>
            </tr>
          </thead>
          <tbody>
            {p.taxonomies.map((t) => (
              <tr key={t.id} className="border-t border-black/5 dark:border-white/5">
                <td className="py-1 pr-3">{t.slot}</td>
                <td className="py-1 pr-3 font-mono text-xs">{t.code}</td>
                <td className="py-1 pr-3">{t.name ?? ""}</td>
                <td className="py-1 pr-3">{t.isPrimary ? "✓" : ""}</td>
                <td className="py-1 pr-3 font-mono text-xs">{t.license ?? ""}</td>
                <td className="py-1">{t.licenseState ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Addresses">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {p.addresses.map((a) => (
            <div
              key={a.id}
              className="border border-black/10 dark:border-white/10 rounded p-3"
            >
              <div className="text-xs uppercase opacity-60 mb-1">{a.kind}</div>
              <div>{a.line1}</div>
              {a.line2 && <div>{a.line2}</div>}
              <div>
                {[a.city, a.state].filter(Boolean).join(", ")} {a.postalCode}
              </div>
              {a.cbsaName && (
                <div className="text-xs opacity-70 mt-1">
                  Metro: {a.cbsaName}
                  {a.cbsaType === "MICRO" && <span className="opacity-60"> (µSA)</span>}
                </div>
              )}
              {a.phone && (
                <div className="mt-2 text-sm">
                  <span className="opacity-60">Phone:</span>{" "}
                  <a
                    href={`tel:${a.phone.replace(/\D/g, "")}`}
                    className="font-mono hover:underline"
                  >
                    {formatPhone(a.phone)}
                  </a>
                </div>
              )}
              {a.fax && (
                <div className="text-sm">
                  <span className="opacity-60">Fax:</span>{" "}
                  <span className="font-mono">{formatPhone(a.fax)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-8 flex gap-3 text-sm">
        <a
          href={`https://npiregistry.cms.hhs.gov/provider-view/${p.npi}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 border border-black/15 dark:border-white/15 rounded hover:bg-black/5 dark:hover:bg-white/5"
        >
          NPI Registry ↗
        </a>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-medium mb-2">{title}</h2>
      {children}
    </section>
  );
}

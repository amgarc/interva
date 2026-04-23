import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { parseFilters } from "@/lib/search-params";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "NPI",
  "Last Name",
  "First Name",
  "Middle Name",
  "Credentials",
  "Sex",
  "Primary Taxonomy Code",
  "Primary Taxonomy Name",
  "Primary Taxonomy License",
  "Primary Taxonomy License State",
  "All Taxonomy Codes",
  "Active IR",
  "Total IR Services",
  "Total IR Beneficiaries",
  "Distinct IR CPTs",
  "Active IR Categories",
  "Last IR Billing Year",
  "Practice Address 1",
  "Practice Address 2",
  "Practice City",
  "Practice State",
  "Practice ZIP",
  "Practice Phone",
  "Practice Fax",
  "Mailing Address 1",
  "Mailing Address 2",
  "Mailing City",
  "Mailing State",
  "Mailing ZIP",
  "Mailing Phone",
  "Enumeration Date",
  "Last Update Date",
  "Deactivation Date",
] as const;

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export async function GET(req: NextRequest) {
  const raw: Record<string, string | string[]> = {};
  for (const [k, v] of req.nextUrl.searchParams.entries()) {
    const existing = raw[k];
    if (existing === undefined) raw[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else raw[k] = [existing, v];
  }
  const filters = parseFilters(raw);

  const where: Prisma.PhysicianWhereInput = {};
  const and: Prisma.PhysicianWhereInput[] = [];
  if (!filters.includeDeactivated) and.push({ deactivationDate: null });
  if (filters.q) {
    and.push({
      OR: [
        { lastName: { contains: filters.q, mode: "insensitive" } },
        { firstName: { contains: filters.q, mode: "insensitive" } },
        { middleName: { contains: filters.q, mode: "insensitive" } },
        { npi: { contains: filters.q } },
        { credentials: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.state) {
    and.push({
      addresses: { some: { kind: "practice", state: filters.state } },
    });
  }
  if (filters.activeIrOnly) {
    and.push({ isActiveIr: true });
  }
  if (filters.taxonomyCodes.length > 0) {
    and.push({
      taxonomies: {
        some: {
          code: { in: filters.taxonomyCodes },
          ...(filters.primaryOnly && { isPrimary: true }),
        },
      },
    });
  }
  if (and.length > 0) where.AND = and;

  const rows = await prisma.physician.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      taxonomies: { orderBy: { slot: "asc" } },
      addresses: true,
    },
  });

  const lines: string[] = [];
  lines.push(CSV_COLUMNS.map(csvEscape).join(","));

  for (const p of rows) {
    const primary = p.taxonomies.find((t) => t.isPrimary) ?? p.taxonomies[0];
    const practice = p.addresses.find((a) => a.kind === "practice");
    const mailing = p.addresses.find((a) => a.kind === "mailing");
    const allCodes = p.taxonomies.map((t) => t.code).join("; ");

    lines.push(
      [
        p.npi,
        p.lastName,
        p.firstName,
        p.middleName,
        p.credentials,
        p.gender,
        primary?.code,
        primary?.name,
        primary?.license,
        primary?.licenseState,
        allCodes,
        p.isActiveIr ? "Y" : "N",
        p.totalIrServices,
        p.totalIrBenes,
        p.distinctIrCpts,
        p.activeIrCategories.join("; "),
        p.lastIrBillingYear,
        practice?.line1,
        practice?.line2,
        practice?.city,
        practice?.state,
        practice?.postalCode,
        practice?.phone,
        practice?.fax,
        mailing?.line1,
        mailing?.line2,
        mailing?.city,
        mailing?.state,
        mailing?.postalCode,
        mailing?.phone,
        formatDate(p.enumerationDate),
        formatDate(p.lastUpdatedDate),
        formatDate(p.deactivationDate),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const body = lines.join("\n") + "\n";
  const filename = `interva-ir-physicians-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

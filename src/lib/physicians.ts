import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export interface PhysicianFilters {
  q?: string;
  state?: string;
  cbsaCode?: string;
  taxonomyCodes?: string[];
  primaryOnly?: boolean;
  includeDeactivated?: boolean;
  activeIrOnly?: boolean;
  practiceSetting?: string; // "OBL" | "FACILITY" | "MIXED"
  ascAffiliated?: boolean;
  hospitalAffiliated?: boolean;
  oblOrAsc?: boolean; // convenience: OBL setting OR ASC-affiliated
  page?: number;
  perPage?: number;
  sortBy?: "lastName" | "enumerationDate" | "state" | "irVolume";
  sortDir?: "asc" | "desc";
}

export const DEFAULT_PER_PAGE = 50;
export const MAX_PER_PAGE = 500;

function buildWhere(filters: PhysicianFilters): Prisma.PhysicianWhereInput {
  const and: Prisma.PhysicianWhereInput[] = [];

  if (!filters.includeDeactivated) {
    and.push({ deactivationDate: null });
  }

  const q = filters.q?.trim();
  if (q) {
    and.push({
      OR: [
        { lastName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { middleName: { contains: q, mode: "insensitive" } },
        { npi: { contains: q } },
        { credentials: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (filters.state) {
    and.push({
      addresses: {
        some: { kind: "practice", state: filters.state.toUpperCase() },
      },
    });
  }

  if (filters.cbsaCode) {
    and.push({
      addresses: {
        some: { kind: "practice", cbsaCode: filters.cbsaCode },
      },
    });
  }

  if (filters.practiceSetting) {
    and.push({ practiceSetting: filters.practiceSetting });
  }

  if (filters.ascAffiliated) {
    and.push({ hasAscAffiliation: true });
  }

  if (filters.hospitalAffiliated) {
    and.push({ hasHospitalAffiliation: true });
  }

  if (filters.oblOrAsc) {
    and.push({
      OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }],
    });
  }

  if (filters.activeIrOnly) {
    and.push({ isActiveIr: true });
  }

  if (filters.taxonomyCodes && filters.taxonomyCodes.length > 0) {
    and.push({
      taxonomies: {
        some: {
          code: { in: filters.taxonomyCodes },
          ...(filters.primaryOnly && { isPrimary: true }),
        },
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

function buildOrderBy(
  filters: PhysicianFilters,
): Prisma.PhysicianOrderByWithRelationInput[] {
  const dir = filters.sortDir ?? "asc";
  switch (filters.sortBy) {
    case "enumerationDate":
      return [{ enumerationDate: dir }, { lastName: "asc" }];
    case "irVolume":
      return [{ totalIrServices: { sort: dir, nulls: "last" } }, { lastName: "asc" }];
    case "state":
      return [{ lastName: "asc" }, { firstName: "asc" }];
    case "lastName":
    default:
      return [{ lastName: dir }, { firstName: "asc" }];
  }
}

export async function listPhysicians(filters: PhysicianFilters) {
  const perPage = Math.min(filters.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE);
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.physician.findMany({
      where,
      orderBy: buildOrderBy(filters),
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        taxonomies: { orderBy: { slot: "asc" } },
        addresses: true,
      },
    }),
    prisma.physician.count({ where }),
  ]);

  return { rows, total, page, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getPhysicianByNpi(npi: string) {
  return prisma.physician.findUnique({
    where: { npi },
    include: {
      taxonomies: { orderBy: { slot: "asc" } },
      addresses: true,
      procedures: { orderBy: [{ year: "desc" }, { totServices: "desc" }] },
      affiliations: {
        include: { facility: true },
        orderBy: [{ facility: { kind: "asc" } }, { facility: { name: "asc" } }],
      },
      facts: {
        where: { supersededById: null },
        include: { source: true },
        orderBy: { fetchedAt: "desc" },
      },
      signals: { orderBy: { occurredAt: "desc" }, take: 20 },
      channels: { include: { sourceFact: { include: { source: true } } } },
      persona: true,
      outreach: true,
      actions: { orderBy: { occurredAt: "desc" }, take: 20 },
    },
  });
}

// Return the set of practice-location state codes, for the state dropdown.
export async function listPracticeStates(): Promise<string[]> {
  const rows = await prisma.physicianAddress.findMany({
    where: { kind: "practice", state: { not: null } },
    select: { state: true },
    distinct: ["state"],
  });
  return rows
    .map((r) => r.state as string)
    .filter((s) => s.length === 2)
    .sort();
}

export interface MetroOption {
  code: string;
  name: string;
  practiceCount: number;
}

// Return CBSAs that have ≥1 IR physician practicing there, sorted by count.
export async function listPracticeMetros(state?: string): Promise<MetroOption[]> {
  const grouped = await prisma.physicianAddress.groupBy({
    by: ["cbsaCode", "cbsaName"],
    where: {
      kind: "practice",
      cbsaCode: { not: null },
      ...(state && { state: state.toUpperCase() }),
    },
    _count: { npi: true },
    orderBy: { _count: { npi: "desc" } },
  });
  return grouped
    .filter((g) => g.cbsaCode && g.cbsaName)
    .map((g) => ({
      code: g.cbsaCode as string,
      name: g.cbsaName as string,
      practiceCount: g._count.npi,
    }));
}

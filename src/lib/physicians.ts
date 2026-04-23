import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export interface PhysicianFilters {
  q?: string;
  state?: string;
  taxonomyCodes?: string[];
  primaryOnly?: boolean;
  includeDeactivated?: boolean;
  page?: number;
  perPage?: number;
  sortBy?: "lastName" | "enumerationDate" | "state";
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
    case "state":
      // Sort by state requires joining; approximate by name for now and let
      // the UI filter/sort by state explicitly when needed.
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

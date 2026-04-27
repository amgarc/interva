// Common scaffolding for every enrichment worker.
//
// Contract: an enricher exports `runEnricher(npis?: string[])`. If npis is
// omitted, the enricher picks its own scope (e.g., "all OBL/ASC active IRs").
// It writes Facts/Signals/Channels and updates the Source.lastRunAt/
// lastSuccessAt timestamps.

import { PrismaClient, Prisma } from "@prisma/client";

export interface FactInput {
  npi: string;
  fieldPath: string;
  value: Prisma.InputJsonValue;
  valueText?: string;
  sourceUrl?: string;
  validUntil?: Date;
  confidence?: number;
}

export interface SignalInput {
  npi: string;
  kind: string;
  occurredAt: Date;
  summary: string;
  payload?: Prisma.InputJsonValue;
  expiresAt?: Date;
  sourceFactId?: bigint;
}

export interface ChannelInput {
  npi: string;
  kind: string;
  value: string;
  isPreferred?: boolean;
  verified?: boolean;
  verifyMethod?: string;
  sourceFactId?: bigint;
}

export interface EnrichResult {
  factsWritten: number;
  signalsWritten: number;
  channelsWritten: number;
  errors: { npi?: string; message: string }[];
}

// Convenience helper: write a batch of Facts; idempotent by (npi, fieldPath, sourceKey).
// If a Fact already exists for this triple within `freshnessHours`, skip; else
// create new and mark older one as superseded.
export async function writeFacts(
  prisma: PrismaClient,
  sourceKey: string,
  facts: FactInput[],
  freshnessHours: number,
): Promise<{ written: number; ids: Map<string, bigint> }> {
  const cutoff = new Date(Date.now() - freshnessHours * 3600 * 1000);
  const ids = new Map<string, bigint>(); // key: `${npi}|${fieldPath}` → most recent id
  let written = 0;

  for (const f of facts) {
    // Check if a recent Fact already exists for this exact triple.
    const existing = await prisma.fact.findFirst({
      where: {
        npi: f.npi,
        fieldPath: f.fieldPath,
        sourceKey,
        fetchedAt: { gte: cutoff },
        supersededById: null,
      },
      orderBy: { fetchedAt: "desc" },
    });
    if (existing) {
      ids.set(`${f.npi}|${f.fieldPath}`, existing.id);
      continue;
    }
    // Mark any older non-superseded same-triple Facts as superseded.
    const created = await prisma.fact.create({
      data: {
        npi: f.npi,
        fieldPath: f.fieldPath,
        value: f.value,
        valueText: f.valueText ?? null,
        sourceKey,
        sourceUrl: f.sourceUrl ?? null,
        validUntil: f.validUntil ?? null,
        confidence: f.confidence ?? 0.7,
      },
    });
    await prisma.fact.updateMany({
      where: {
        npi: f.npi,
        fieldPath: f.fieldPath,
        sourceKey,
        id: { not: created.id },
        supersededById: null,
      },
      data: { supersededById: created.id },
    });
    ids.set(`${f.npi}|${f.fieldPath}`, created.id);
    written++;
  }
  return { written, ids };
}

export async function writeSignals(
  prisma: PrismaClient,
  signals: SignalInput[],
): Promise<number> {
  if (signals.length === 0) return 0;
  // Idempotent on (npi, kind, occurredAt, summary).
  const seen = new Set<string>();
  const fresh: SignalInput[] = [];
  for (const s of signals) {
    const key = `${s.npi}|${s.kind}|${s.occurredAt.toISOString().slice(0, 10)}|${s.summary}`;
    if (seen.has(key)) continue;
    const exists = await prisma.outreachSignal.findFirst({
      where: {
        npi: s.npi,
        kind: s.kind,
        occurredAt: s.occurredAt,
        summary: s.summary,
      },
    });
    if (exists) continue;
    fresh.push(s);
    seen.add(key);
  }
  if (fresh.length === 0) return 0;
  const result = await prisma.outreachSignal.createMany({
    data: fresh.map((s) => ({
      npi: s.npi,
      kind: s.kind,
      occurredAt: s.occurredAt,
      summary: s.summary,
      payload: s.payload ?? Prisma.JsonNull,
      expiresAt: s.expiresAt ?? null,
      sourceFactId: s.sourceFactId ?? null,
    })),
  });
  return result.count;
}

export async function writeChannels(
  prisma: PrismaClient,
  channels: ChannelInput[],
): Promise<number> {
  let written = 0;
  for (const c of channels) {
    const result = await prisma.contactChannel.upsert({
      where: { npi_kind_value: { npi: c.npi, kind: c.kind, value: c.value } },
      create: {
        npi: c.npi,
        kind: c.kind,
        value: c.value,
        isPreferred: c.isPreferred ?? false,
        verified: c.verified ?? false,
        verifyMethod: c.verifyMethod ?? null,
        sourceFactId: c.sourceFactId ?? null,
      },
      update: {
        verified: c.verified ?? false,
        verifyMethod: c.verifyMethod ?? null,
      },
    });
    if (result) written++;
  }
  return written;
}

export async function markSourceRunStart(prisma: PrismaClient, sourceKey: string) {
  await prisma.source.update({
    where: { key: sourceKey },
    data: { lastRunAt: new Date() },
  });
}

export async function markSourceRunSuccess(prisma: PrismaClient, sourceKey: string) {
  await prisma.source.update({
    where: { key: sourceKey },
    data: { lastSuccessAt: new Date() },
  });
}

// Default cohort: active OBL/ASC IRs (Interva's primary commercial TAM).
export async function getOblAscActiveCohort(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.physician.findMany({
    where: {
      isActiveIr: true,
      OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }],
    },
    select: { npi: true },
  });
  return rows.map((r) => r.npi);
}

// Wider cohort: every IR physician we have. Activated via COHORT=all env var.
export async function getAllIrCohort(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.physician.findMany({
    where: { deactivationDate: null },
    select: { npi: true },
  });
  return rows.map((r) => r.npi);
}

// Pick cohort based on COHORT env var. Default: OBL/ASC active.
export async function pickCohort(prisma: PrismaClient): Promise<string[]> {
  if (process.env.COHORT === "all") return getAllIrCohort(prisma);
  return getOblAscActiveCohort(prisma);
}

// Sleep helper for rate-limiting.
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Re-export so workers don't need their own.
export { PrismaClient, Prisma };

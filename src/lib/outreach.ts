// Server-side helpers for the outreach state machine.

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

// Sales-pipeline stages. Kept short and outcome-oriented.
export const STAGES = [
  "prospect",     // identified, not yet contacted
  "outreach",     // first touch sent, awaiting reply
  "discussion",   // replied, in active conversation
  "committed",    // verbal yes / agreement-in-principle
  "contracted",   // contract signed / closed-won
  "no_go",        // not pursuing (lost, declined, or disqualified)
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_DISPLAY: Record<Stage, string> = {
  prospect: "Prospect",
  outreach: "Outreach",
  discussion: "Discussion",
  committed: "Committed",
  contracted: "Contracted",
  no_go: "No-go",
};

export const STAGE_COLOR: Record<Stage, string> = {
  prospect: "bg-slate-200 dark:bg-slate-800",
  outreach: "bg-amber-200/60 dark:bg-amber-900/40",
  discussion: "bg-orange-200/60 dark:bg-orange-900/40",
  committed: "bg-violet-200/60 dark:bg-violet-900/40",
  contracted: "bg-emerald-200/60 dark:bg-emerald-900/40",
  no_go: "bg-stone-200/60 dark:bg-stone-900/40",
};

export async function listOutreachByStage() {
  const rows = await prisma.outreachStage.findMany({
    include: {
      physician: {
        include: {
          persona: true,
          addresses: { where: { kind: "practice" }, take: 1 },
        },
      },
    },
    orderBy: { lastTouchAt: "desc" },
  });
  const grouped = new Map<Stage, typeof rows>();
  for (const s of STAGES) grouped.set(s, []);
  for (const r of rows) {
    const stage = (r.stage as Stage) ?? "untouched";
    grouped.get(stage)?.push(r);
  }
  return grouped;
}

export async function setStage(npi: string, stage: Stage, ownerId?: string, notes?: string): Promise<void> {
  await prisma.outreachStage.upsert({
    where: { npi },
    create: {
      npi,
      stage,
      ownerId: ownerId ?? null,
      enteredAt: new Date(),
      lastTouchAt: new Date(),
      notes: notes ?? null,
    },
    update: {
      stage,
      ownerId: ownerId ?? undefined,
      lastTouchAt: new Date(),
      notes: notes ?? undefined,
    },
  });
}

export async function logAction(
  npi: string,
  data: {
    channel: string;
    direction: "outbound" | "inbound";
    status?: string;
    templateId?: string;
    campaignId?: string;
    subject?: string;
    body?: string;
    externalId?: string;
    payload?: Prisma.InputJsonValue;
    ownerId?: string;
  },
): Promise<void> {
  await prisma.outreachAction.create({ data: { npi, ...data } });
  await prisma.outreachStage.update({
    where: { npi },
    data: { lastTouchAt: new Date() },
  }).catch(() => {});
}

// Mass-enroll: seed an OutreachStage row for every physician matching a
// query, defaulting to "enriched" if they have a Persona, else "untouched".
export async function seedStagesForCohort(
  where: Prisma.PhysicianWhereInput,
  defaultStage: Stage = "prospect",
): Promise<number> {
  const rows = await prisma.physician.findMany({
    where: {
      AND: [where, { outreach: null }],
    },
    select: { npi: true },
  });
  if (rows.length === 0) return 0;
  const data = rows.map((r) => ({
    npi: r.npi,
    stage: defaultStage,
    enteredAt: new Date(),
  }));
  const result = await prisma.outreachStage.createMany({
    data,
    skipDuplicates: true,
  });
  return result.count;
}

// One-time migration: collapse old 10-stage values to new 6-stage values.
export async function migrateLegacyStages(): Promise<void> {
  const mapping: Record<string, Stage> = {
    untouched: "prospect",
    enriched: "prospect",
    qualified: "prospect",
    queued: "outreach",
    contacted: "outreach",
    engaged: "discussion",
    meeting: "discussion",
    won: "contracted",
    lost: "no_go",
    dnq: "no_go",
  };
  for (const [oldStage, newStage] of Object.entries(mapping)) {
    await prisma.outreachStage.updateMany({
      where: { stage: oldStage },
      data: { stage: newStage },
    });
  }
}

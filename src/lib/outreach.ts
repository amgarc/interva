// Server-side helpers for the outreach state machine.

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const STAGES = [
  "untouched",
  "enriched",
  "qualified",
  "queued",
  "contacted",
  "engaged",
  "meeting",
  "won",
  "lost",
  "dnq",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_DISPLAY: Record<Stage, string> = {
  untouched: "Untouched",
  enriched: "Enriched",
  qualified: "Qualified",
  queued: "Queued",
  contacted: "Contacted",
  engaged: "Engaged",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost",
  dnq: "Disqualified",
};

export const STAGE_COLOR: Record<Stage, string> = {
  untouched: "bg-slate-200 dark:bg-slate-800",
  enriched: "bg-blue-200/60 dark:bg-blue-900/40",
  qualified: "bg-cyan-200/60 dark:bg-cyan-900/40",
  queued: "bg-violet-200/60 dark:bg-violet-900/40",
  contacted: "bg-amber-200/60 dark:bg-amber-900/40",
  engaged: "bg-orange-200/60 dark:bg-orange-900/40",
  meeting: "bg-purple-200/60 dark:bg-purple-900/40",
  won: "bg-emerald-200/60 dark:bg-emerald-900/40",
  lost: "bg-red-200/60 dark:bg-red-900/40",
  dnq: "bg-stone-200/60 dark:bg-stone-900/40",
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
  defaultStage: Stage = "enriched",
): Promise<number> {
  const rows = await prisma.physician.findMany({
    where: {
      AND: [where, { outreach: null }],
    },
    select: { npi: true, persona: { select: { archetype: true } } },
  });
  if (rows.length === 0) return 0;
  const data = rows.map((r) => ({
    npi: r.npi,
    stage: r.persona ? defaultStage : "untouched",
    enteredAt: new Date(),
  }));
  const result = await prisma.outreachStage.createMany({
    data,
    skipDuplicates: true,
  });
  return result.count;
}

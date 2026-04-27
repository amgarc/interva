// Automation rule engine.
//
// Runs as cron or on-demand:
//   npm run automation:run                   # evaluate all enabled rules
//   npm run automation:run -- --rule=<id>    # one rule
//   npm run automation:run -- --dry-run      # don't execute actions
//
// Trigger types:
//   { type: "FACT_ADDED", fieldPath?: string }            — Facts created since lastFiredAt
//   { type: "SIGNAL_ADDED", kind?: string }                — Signals created since lastFiredAt
//   { type: "STAGE_CHANGED", to?: string }                 — OutreachStages updated since lastFiredAt
//
// Condition (small DSL — boolean expression evaluated per candidate physician):
//   { all: [...] } | { any: [...] }
//   leaf: { field: "physician.isActiveIr", op: "eq", value: true }
//         field can be:
//           physician.<scalar>      e.g. "physician.practiceSetting"
//           persona.<field>          e.g. "persona.archetype"
//           fact.<fieldPath>         e.g. "fact.contact.email_practice" (truthy if exists)
//           signal.<kind>            e.g. "signal.PUBLISHED_PAPER" (truthy if any)
//           channel.<kind>           e.g. "channel.email_practice" (truthy if any)
//         ops: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "exists" | "contains"
//
// Action types:
//   { type: "WEBHOOK", url, method?: "POST", headers? }
//   { type: "SET_STAGE", stage }
//   { type: "LOG", message }

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type ConditionLeaf = {
  field: string; // "physician.isActiveIr" | "fact.<path>" | "signal.<kind>" | ...
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "exists" | "contains";
  value?: unknown;
};
type Condition = ConditionLeaf | { all: Condition[] } | { any: Condition[] };

interface PhysicianBundle {
  npi: string;
  physician: Awaited<ReturnType<typeof loadPhysician>>;
}

async function loadPhysician(npi: string) {
  return prisma.physician.findUnique({
    where: { npi },
    include: {
      persona: true,
      facts: { where: { supersededById: null } },
      signals: { take: 50, orderBy: { occurredAt: "desc" } },
      channels: true,
      outreach: true,
    },
  });
}

function getLeafValue(field: string, p: NonNullable<Awaited<ReturnType<typeof loadPhysician>>>): unknown {
  const [scope, ...rest] = field.split(".");
  const path = rest.join(".");
  switch (scope) {
    case "physician": {
      // @ts-expect-error dynamic scalar lookup
      return p[path];
    }
    case "persona": {
      // @ts-expect-error
      return p.persona?.[path];
    }
    case "fact": {
      const f = p.facts.find((f) => f.fieldPath === path);
      return f ? f.value : undefined;
    }
    case "signal": {
      return p.signals.find((s) => s.kind === path) ? true : false;
    }
    case "channel": {
      return p.channels.some((c) => c.kind === path);
    }
    default:
      return undefined;
  }
}

function evalCondition(cond: Condition, p: NonNullable<Awaited<ReturnType<typeof loadPhysician>>>): boolean {
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, p));
  if ("any" in cond) return cond.any.some((c) => evalCondition(c, p));
  const left = getLeafValue(cond.field, p);
  switch (cond.op) {
    case "exists":
      return left !== undefined && left !== null && left !== false;
    case "eq":
      return left === cond.value;
    case "ne":
      return left !== cond.value;
    case "gt":
      return typeof left === "number" && typeof cond.value === "number" && left > cond.value;
    case "gte":
      return typeof left === "number" && typeof cond.value === "number" && left >= cond.value;
    case "lt":
      return typeof left === "number" && typeof cond.value === "number" && left < cond.value;
    case "lte":
      return typeof left === "number" && typeof cond.value === "number" && left <= cond.value;
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(left);
    case "contains": {
      if (typeof left === "string" && typeof cond.value === "string") return left.includes(cond.value);
      if (Array.isArray(left) && cond.value !== undefined) return left.includes(cond.value);
      return false;
    }
    default:
      return false;
  }
}

async function runAction(
  action: Prisma.JsonValue,
  npi: string,
  context: NonNullable<Awaited<ReturnType<typeof loadPhysician>>>,
  dryRun: boolean,
): Promise<{ ok: boolean; message: string }> {
  const a = action as { type?: string; [k: string]: unknown };
  if (!a || typeof a !== "object" || !a.type) {
    return { ok: false, message: "missing action.type" };
  }
  switch (a.type) {
    case "LOG":
      console.log(`    [LOG] ${npi}: ${a.message ?? "fired"}`);
      return { ok: true, message: `logged` };
    case "SET_STAGE": {
      if (dryRun) return { ok: true, message: `dry-run set_stage=${a.stage}` };
      await prisma.outreachStage.upsert({
        where: { npi },
        create: { npi, stage: String(a.stage), enteredAt: new Date(), lastTouchAt: new Date() },
        update: { stage: String(a.stage), lastTouchAt: new Date() },
      });
      return { ok: true, message: `stage→${a.stage}` };
    }
    case "WEBHOOK": {
      if (dryRun) return { ok: true, message: `dry-run webhook=${a.url}` };
      const payload = {
        npi,
        firstName: context.firstName,
        lastName: context.lastName,
        archetype: context.persona?.archetype,
        hookSummary: context.persona?.hookSummary,
        firedAt: new Date().toISOString(),
      };
      try {
        const res = await fetch(String(a.url), {
          method: typeof a.method === "string" ? a.method : "POST",
          headers: {
            "content-type": "application/json",
            ...(typeof a.headers === "object" && a.headers ? (a.headers as Record<string, string>) : {}),
          },
          body: JSON.stringify(payload),
        });
        return { ok: res.ok, message: `webhook ${res.status}` };
      } catch (err) {
        return { ok: false, message: `webhook err: ${(err as Error).message}` };
      }
    }
    default:
      return { ok: false, message: `unknown action.type ${a.type}` };
  }
}

async function findCandidates(
  trigger: Prisma.JsonValue,
  since: Date | null,
): Promise<string[]> {
  const t = trigger as { type?: string; [k: string]: unknown };
  if (!t || !t.type) return [];
  const cutoff = since ?? new Date(0);
  switch (t.type) {
    case "FACT_ADDED": {
      const where: Prisma.FactWhereInput = { fetchedAt: { gt: cutoff } };
      if (typeof t.fieldPath === "string") where.fieldPath = t.fieldPath;
      const rows = await prisma.fact.findMany({
        where,
        distinct: ["npi"],
        select: { npi: true },
        take: 5000,
      });
      return rows.map((r) => r.npi);
    }
    case "SIGNAL_ADDED": {
      const where: Prisma.OutreachSignalWhereInput = { createdAt: { gt: cutoff } };
      if (typeof t.kind === "string") where.kind = t.kind;
      const rows = await prisma.outreachSignal.findMany({
        where,
        distinct: ["npi"],
        select: { npi: true },
        take: 5000,
      });
      return rows.map((r) => r.npi);
    }
    case "STAGE_CHANGED": {
      const where: Prisma.OutreachStageWhereInput = { lastTouchAt: { gt: cutoff } };
      if (typeof t.to === "string") where.stage = t.to;
      const rows = await prisma.outreachStage.findMany({
        where,
        select: { npi: true },
        take: 5000,
      });
      return rows.map((r) => r.npi);
    }
    default:
      return [];
  }
}

export async function runAutomation(opts: { ruleId?: number; dryRun?: boolean } = {}): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: opts.ruleId ? { id: opts.ruleId } : { enabled: true },
  });
  console.log(`[automation] Evaluating ${rules.length} rule${rules.length === 1 ? "" : "s"}${opts.dryRun ? " (DRY RUN)" : ""}`);

  for (const rule of rules) {
    console.log(`\n[rule ${rule.id}] "${rule.name}"`);
    const candidates = await findCandidates(rule.trigger, rule.lastFiredAt);
    console.log(`  candidates: ${candidates.length}`);
    if (candidates.length === 0) continue;

    let fired = 0;
    let skipped = 0;
    let failed = 0;
    for (const npi of candidates) {
      const p = await loadPhysician(npi);
      if (!p) {
        skipped++;
        continue;
      }
      const cond = rule.condition as Condition;
      if (cond && !evalCondition(cond, p)) {
        skipped++;
        continue;
      }
      const result = await runAction(rule.action, npi, p, opts.dryRun ?? false);
      if (result.ok) fired++;
      else failed++;
    }

    if (!opts.dryRun) {
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { lastFiredAt: new Date(), fireCount: { increment: fired } },
      });
    }
    console.log(`  fired=${fired} skipped=${skipped} failed=${failed}`);
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  const ruleArg = process.argv.find((a) => a.startsWith("--rule="));
  const ruleId = ruleArg ? parseInt(ruleArg.split("=")[1], 10) : undefined;
  runAutomation({ ruleId, dryRun })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

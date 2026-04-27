// Seed example AutomationRules so the engine has something to evaluate.
// Idempotent on rule.name.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RULES = [
  {
    name: "Active OBL/ASC IR with verified email → mark qualified",
    description:
      "Once enrichment surfaces a verified practice email AND we have an Interva persona for an active OBL/ASC IR, advance them to 'qualified'.",
    trigger: { type: "FACT_ADDED", fieldPath: "contact.email_practice" },
    condition: {
      all: [
        { field: "physician.isActiveIr", op: "eq", value: true },
        { field: "persona.archetype", op: "in", value: ["OBL_PARTNER_OWNER", "ASC_PARTNER", "OBL_PRACTITIONER", "ASC_HYBRID"] },
        { field: "channel.email_practice", op: "exists" },
      ],
    },
    action: { type: "SET_STAGE", stage: "qualified" },
  },
  {
    name: "OIG-excluded → set DNQ",
    description: "Disqualify any physician on the OIG exclusion list.",
    trigger: { type: "FACT_ADDED", fieldPath: "compliance.oig_excluded" },
    condition: { field: "fact.compliance.oig_excluded", op: "exists" },
    action: { type: "SET_STAGE", stage: "dnq" },
  },
  {
    name: "Recent paper → webhook trigger (warm-up campaign)",
    description:
      "When a physician publishes a new paper (PubMed signal), POST to webhook so external tools can enroll them in a 'congratulations on recent paper' campaign.",
    trigger: { type: "SIGNAL_ADDED", kind: "PUBLISHED_PAPER" },
    condition: {
      all: [
        { field: "persona.archetype", op: "ne", value: "DISQUALIFIED" },
        { field: "physician.isActiveIr", op: "eq", value: true },
      ],
    },
    action: {
      type: "WEBHOOK",
      url: "https://webhook.site/your-test-id-here",
      method: "POST",
    },
  },
  {
    name: "Active trial investigator → log (vendor-engaged)",
    description:
      "Surface physicians newly identified as active clinical-trial investigators (already commercially engaged with industry).",
    trigger: { type: "SIGNAL_ADDED", kind: "ACTIVE_TRIAL_INVESTIGATOR" },
    condition: { field: "physician.isActiveIr", op: "eq", value: true },
    action: { type: "LOG", message: "trial-investigator commercial signal" },
  },
];

async function main() {
  for (const r of RULES) {
    const existing = await prisma.automationRule.findFirst({ where: { name: r.name } });
    if (existing) {
      await prisma.automationRule.update({
        where: { id: existing.id },
        data: {
          description: r.description,
          trigger: r.trigger,
          condition: r.condition,
          action: r.action,
        },
      });
      console.log(`[rule ${existing.id}] updated: ${r.name}`);
    } else {
      const created = await prisma.automationRule.create({
        data: {
          name: r.name,
          description: r.description,
          trigger: r.trigger,
          condition: r.condition,
          action: r.action,
        },
      });
      console.log(`[rule ${created.id}] created: ${r.name}`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

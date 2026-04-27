// Seed OutreachStage rows for the primary OBL/ASC active commercial-TAM cohort.
// Idempotent — only inserts physicians who don't already have a stage row.
//
// Usage:
//   npx tsx scripts/seed-outreach.ts oblasc-active   (default)
//   npx tsx scripts/seed-outreach.ts all-active

import { PrismaClient } from "@prisma/client";
import { seedStagesForCohort } from "../src/lib/outreach";

const prisma = new PrismaClient();

async function main() {
  const cohort = process.argv[2] ?? "oblasc-active";
  let count = 0;
  if (cohort === "oblasc-active") {
    count = await seedStagesForCohort(
      {
        isActiveIr: true,
        OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }],
      },
      "prospect",
    );
  } else if (cohort === "all-active") {
    count = await seedStagesForCohort({ isActiveIr: true }, "prospect");
  } else if (cohort === "all") {
    count = await seedStagesForCohort({}, "prospect");
  } else {
    console.error(`Unknown cohort: ${cohort}`);
    process.exit(1);
  }
  console.log(`Seeded ${count.toLocaleString()} OutreachStage rows for cohort=${cohort}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Idempotent: upserts every source defined in src/lib/sources.ts into the
// Source table. Run after every prisma db push that touches the Source model.

import { PrismaClient } from "@prisma/client";
import { SOURCES } from "../src/lib/sources";

const prisma = new PrismaClient();

async function main() {
  for (const s of SOURCES) {
    await prisma.source.upsert({
      where: { key: s.key },
      create: {
        key: s.key,
        displayName: s.displayName,
        category: s.category,
        baseConfidence: s.baseConfidence,
        freshnessHours: s.freshnessHours,
        notes: s.notes ?? null,
      },
      update: {
        displayName: s.displayName,
        category: s.category,
        baseConfidence: s.baseConfidence,
        freshnessHours: s.freshnessHours,
        notes: s.notes ?? null,
      },
    });
  }
  console.log(`Seeded ${SOURCES.length} sources.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

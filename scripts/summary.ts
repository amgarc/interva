import { PrismaClient } from "@prisma/client";
import { IR_TAXONOMY_CODES } from "../src/lib/taxonomies";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.physician.count();
  const active = await prisma.physician.count({ where: { deactivationDate: null } });

  console.log(`\n=== Physicians ===`);
  console.log(`  total:  ${total.toLocaleString()}`);
  console.log(`  active: ${active.toLocaleString()} (no deactivation date)`);

  console.log(`\n=== Breakdown by IR taxonomy (primary slot only) ===`);
  for (const code of IR_TAXONOMY_CODES) {
    const n = await prisma.physicianTaxonomy.count({
      where: { code, isPrimary: true },
    });
    console.log(`  ${code}  primary-taxonomy count: ${n.toLocaleString()}`);
  }

  console.log(`\n=== Breakdown by IR taxonomy (any slot, primary or secondary) ===`);
  for (const code of IR_TAXONOMY_CODES) {
    const n = await prisma.physicianTaxonomy.count({ where: { code } });
    console.log(`  ${code}  any-slot count: ${n.toLocaleString()}`);
  }

  console.log(`\n=== Top 10 states by physician practice location ===`);
  const states = await prisma.physicianAddress.groupBy({
    by: ["state"],
    where: { kind: "practice", state: { not: null } },
    _count: { npi: true },
    orderBy: { _count: { npi: "desc" } },
    take: 10,
  });
  for (const s of states) {
    console.log(`  ${s.state}  ${s._count.npi.toLocaleString()}`);
  }

  console.log(`\n=== Ingest runs ===`);
  const runs = await prisma.ingestRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 3,
  });
  for (const r of runs) {
    const secs = r.finishedAt
      ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)
      : null;
    console.log(
      `  #${r.id} ${r.source} ${r.status} read=${r.rowsRead.toLocaleString()} matched=${r.rowsMatched} upserted=${r.rowsUpserted} ${secs ? `(${secs}s)` : ""}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

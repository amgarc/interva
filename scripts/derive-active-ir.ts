// Derives active-IR flag + volume summary fields on each Physician from
// ProcedureVolume rows populated by the PUF ingest.
//
// Usage:
//   npm run derive:active-ir                 # default threshold = 10 services
//   npm run derive:active-ir -- 25           # custom threshold

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_THRESHOLD = 10;

async function main(): Promise<void> {
  const threshold = parseInt(process.argv[2] ?? String(DEFAULT_THRESHOLD), 10);
  if (isNaN(threshold) || threshold < 0) {
    console.error(`Invalid threshold: ${process.argv[2]}`);
    process.exit(1);
  }
  console.log(`Deriving active-IR flag with threshold: ≥${threshold} services`);

  // One pass: compute per-NPI aggregates from ProcedureVolume and write to
  // Physician. Uses COALESCE so suppressed Tot_Benes (null) counts as 0.
  const updated = await prisma.$executeRaw`
    UPDATE "Physician" p SET
      "lastIrBillingYear"  = stats.last_year,
      "totalIrServices"    = stats.total_services,
      "totalIrBenes"       = stats.total_benes,
      "distinctIrCpts"     = stats.distinct_cpts,
      "activeIrCategories" = stats.categories,
      "isActiveIr"         = stats.total_services >= ${threshold}
    FROM (
      SELECT
        npi,
        MAX(year)                              AS last_year,
        SUM("totServices")::int                AS total_services,
        SUM(COALESCE("totBenes", 0))::int      AS total_benes,
        COUNT(DISTINCT cpt)::int               AS distinct_cpts,
        ARRAY_AGG(DISTINCT category ORDER BY category) AS categories
      FROM "ProcedureVolume"
      GROUP BY npi
    ) stats
    WHERE p.npi = stats.npi
  `;
  console.log(`  Updated ${updated.toLocaleString()} physicians with volume data`);

  // Reset physicians who no longer have any PUF rows (e.g., after removing codes).
  const reset = await prisma.$executeRaw`
    UPDATE "Physician" p SET
      "lastIrBillingYear"  = NULL,
      "totalIrServices"    = NULL,
      "totalIrBenes"       = NULL,
      "distinctIrCpts"     = NULL,
      "activeIrCategories" = '{}',
      "isActiveIr"         = false
    WHERE NOT EXISTS (
      SELECT 1 FROM "ProcedureVolume" pv WHERE pv.npi = p.npi
    )
  `;
  console.log(`  Reset ${reset.toLocaleString()} physicians with no PUF data`);

  // Summary.
  const [total, active, inactive, noPuf] = await Promise.all([
    prisma.physician.count(),
    prisma.physician.count({ where: { isActiveIr: true } }),
    prisma.physician.count({
      where: { isActiveIr: false, totalIrServices: { not: null } },
    }),
    prisma.physician.count({ where: { totalIrServices: null } }),
  ]);

  console.log(`\n=== Active-IR summary ===`);
  console.log(`  Total physicians:          ${total.toLocaleString()}`);
  console.log(`  Active IR (≥${threshold} svcs):         ${active.toLocaleString()}  (${((active / total) * 100).toFixed(1)}%)`);
  console.log(`  In PUF but below threshold:${" "}${inactive.toLocaleString()}  (${((inactive / total) * 100).toFixed(1)}%)`);
  console.log(`  Not in PUF (no Medicare):  ${noPuf.toLocaleString()}  (${((noPuf / total) * 100).toFixed(1)}%)`);

  // Top categories among actives.
  console.log(`\n=== Active IR breakdown by category (physicians billing each) ===`);
  const categories = ["VASCULAR", "EMBOLIZATION", "VENOUS_ACCESS", "BIOPSY_DRAINAGE", "DIALYSIS_ACCESS", "TUMOR_ABLATION", "PAIN_PALLIATIVE", "NEUROINTERVENTIONAL"];
  for (const cat of categories) {
    const n = await prisma.physician.count({
      where: { isActiveIr: true, activeIrCategories: { has: cat } },
    });
    console.log(`  ${cat.padEnd(22)} ${n.toLocaleString()}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

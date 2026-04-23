// Diagnostic queries to understand PUF coverage and help pick a better threshold.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Distribution of total services across IR physicians in PUF.
  const buckets = [
    { min: 0, max: 25, label: "0-25" },
    { min: 26, max: 50, label: "26-50" },
    { min: 51, max: 100, label: "51-100" },
    { min: 101, max: 250, label: "101-250" },
    { min: 251, max: 500, label: "251-500" },
    { min: 501, max: 1000, label: "501-1K" },
    { min: 1001, max: 2500, label: "1K-2.5K" },
    { min: 2501, max: 10000, label: "2.5K-10K" },
    { min: 10001, max: 1_000_000, label: "10K+" },
  ];

  console.log("=== Total IR services distribution (among physicians in PUF) ===");
  for (const b of buckets) {
    const n = await prisma.physician.count({
      where: {
        totalIrServices: { gte: b.min, lte: b.max },
      },
    });
    const bar = "█".repeat(Math.round(n / 20));
    console.log(`  ${b.label.padStart(10)}: ${n.toString().padStart(5)} ${bar}`);
  }

  console.log("\n=== Distinct IR CPTs distribution ===");
  const cptBuckets = [
    { min: 1, max: 1 },
    { min: 2, max: 3 },
    { min: 4, max: 6 },
    { min: 7, max: 10 },
    { min: 11, max: 15 },
    { min: 16, max: 50 },
  ];
  for (const b of cptBuckets) {
    const n = await prisma.physician.count({
      where: { distinctIrCpts: { gte: b.min, lte: b.max } },
    });
    const bar = "█".repeat(Math.round(n / 20));
    console.log(`  ${String(b.min).padStart(2)}-${String(b.max).padStart(2)} CPTs: ${n.toString().padStart(5)} ${bar}`);
  }

  console.log("\n=== Top 5 IRs by total services (Tier-1 only) ===");
  const top = await prisma.physician.findMany({
    where: { isActiveIr: true },
    orderBy: { totalIrServices: "desc" },
    take: 5,
    select: {
      npi: true,
      firstName: true,
      lastName: true,
      totalIrServices: true,
      totalIrBenes: true,
      distinctIrCpts: true,
      activeIrCategories: true,
      addresses: { where: { kind: "practice" }, select: { city: true, state: true } },
    },
  });
  for (const p of top) {
    const loc = p.addresses[0] ? `${p.addresses[0].city}, ${p.addresses[0].state}` : "—";
    console.log(
      `  ${p.firstName} ${p.lastName} (NPI ${p.npi}, ${loc}): ${p.totalIrServices?.toLocaleString()} svcs, ${p.distinctIrCpts} distinct CPTs, cats=${p.activeIrCategories.join(",")}`,
    );
  }

  console.log("\n=== Spot check: Dr. Mamdouh Khayat ===");
  const khayat = await prisma.physician.findUnique({
    where: { npi: "1780941583" },
    include: {
      procedures: { orderBy: [{ year: "desc" }, { totServices: "desc" }] },
    },
  });
  if (!khayat) {
    console.log("  Not found (?!)");
  } else {
    console.log(
      `  Active=${khayat.isActiveIr} services=${khayat.totalIrServices ?? "null"} distinctCpts=${khayat.distinctIrCpts ?? "null"} cats=${khayat.activeIrCategories.join(",")}`,
    );
    console.log(`  PUF rows (${khayat.procedures.length}):`);
    for (const pv of khayat.procedures) {
      console.log(
        `    ${pv.year} ${pv.cpt} (${pv.category}) POS=${pv.placeOfService ?? "?"} srvs=${pv.totServices} benes=${pv.totBenes ?? "sup"}`,
      );
    }
  }

  // Category-specific medians for "active" physicians — helps think about what
  // thresholds actually mean in practice.
  console.log("\n=== How many actives would remain at various thresholds? ===");
  const thresholds = [10, 25, 50, 100, 250, 500, 1000];
  for (const t of thresholds) {
    const n = await prisma.physician.count({
      where: { totalIrServices: { gte: t } },
    });
    console.log(`  ≥${String(t).padStart(4)} services: ${n.toLocaleString()}`);
  }

  // What if we require core-IR category activity (exclude venous-access-only)?
  console.log("\n=== Core IR activity (requires vascular / embolization / ablation / dialysis, not just venous access) ===");
  const CORE = ["VASCULAR", "EMBOLIZATION", "TUMOR_ABLATION", "DIALYSIS_ACCESS", "NEUROINTERVENTIONAL"];
  for (const t of [10, 25, 50, 100, 250]) {
    const n = await prisma.physician.count({
      where: {
        totalIrServices: { gte: t },
        activeIrCategories: { hasSome: CORE },
      },
    });
    console.log(`  ≥${String(t).padStart(4)} services AND ≥1 core-IR category: ${n.toLocaleString()}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

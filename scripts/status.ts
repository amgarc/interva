// Prints a full state-of-the-project snapshot. Re-runnable any time.
//   npx tsx scripts/status.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function pct(n: number, of: number): string {
  if (of === 0) return "-";
  return `${((n / of) * 100).toFixed(1)}%`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

async function main() {
  const total = await prisma.physician.count();
  const active = await prisma.physician.count({ where: { isActiveIr: true } });

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Interva — IR Physician Funnel: state of the project");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log(`Total IR physicians:     ${total.toLocaleString()}`);
  console.log(`Active IR (≥25 svcs):    ${active.toLocaleString()}  (${pct(active, total)})`);

  // --- Data sources ingested
  console.log("\n── Data sources ──");
  const runs = await prisma.ingestRun.findMany({
    where: { status: "completed" },
    orderBy: { startedAt: "desc" },
    distinct: ["source"],
    select: {
      source: true,
      startedAt: true,
      rowsRead: true,
      rowsUpserted: true,
    },
  });
  for (const r of runs) {
    const when = r.startedAt.toISOString().slice(0, 10);
    console.log(
      `  ${pad(r.source, 25)} ${when}  read=${r.rowsRead.toLocaleString().padStart(12)}  stored=${r.rowsUpserted.toLocaleString().padStart(7)}`,
    );
  }

  // --- Taxonomy breakdown
  console.log("\n── IR taxonomy mix (any slot) ──");
  const tax = await prisma.physicianTaxonomy.groupBy({
    by: ["code"],
    where: { code: { in: ["2085R0204X", "2085N0700X", "2085P0229X"] } },
    _count: { npi: true },
  });
  const taxNames: Record<string, string> = {
    "2085R0204X": "V&IR  (core IR)",
    "2085N0700X": "Neuroradiology",
    "2085P0229X": "Pediatric Radiology",
  };
  for (const t of tax.sort((a, b) => b._count.npi - a._count.npi)) {
    console.log(`  ${pad(taxNames[t.code] ?? t.code, 24)} ${t._count.npi.toLocaleString().padStart(6)}`);
  }

  // --- Practice setting (PUF-derived)
  console.log("\n── Practice setting (Medicare PUF) ──");
  const settings = await prisma.physician.groupBy({
    by: ["practiceSetting"],
    _count: { npi: true },
  });
  for (const s of settings.sort((a, b) => b._count.npi - a._count.npi)) {
    const label = s.practiceSetting ?? "no PUF";
    console.log(`  ${pad(label, 15)} ${s._count.npi.toLocaleString().padStart(6)}  (${pct(s._count.npi, total)})`);
  }

  // --- Affiliations
  console.log("\n── Facility affiliations ──");
  const hosp = await prisma.physician.count({ where: { hasHospitalAffiliation: true } });
  const asc = await prisma.physician.count({ where: { hasAscAffiliation: true } });
  const both = await prisma.physician.count({
    where: { hasHospitalAffiliation: true, hasAscAffiliation: true },
  });
  const neither = await prisma.physician.count({
    where: { hasHospitalAffiliation: false, hasAscAffiliation: false },
  });
  console.log(`  Hospital-affiliated:     ${hosp.toLocaleString().padStart(6)}  (${pct(hosp, total)})`);
  console.log(`  ASC-affiliated (inferred):${asc.toLocaleString().padStart(5)}  (${pct(asc, total)})`);
  console.log(`  Both:                    ${both.toLocaleString().padStart(6)}  (${pct(both, total)})`);
  console.log(`  Neither:                 ${neither.toLocaleString().padStart(6)}  (${pct(neither, total)})`);

  // --- The commercial TAM funnel
  console.log("\n── Commercial buyer TAM (OBL or ASC) ──");
  const oblOrAsc = await prisma.physician.count({
    where: { OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }] },
  });
  const activeOblOrAsc = await prisma.physician.count({
    where: {
      isActiveIr: true,
      OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }],
    },
  });
  const pureOblOrAsc = await prisma.physician.count({
    where: {
      hasHospitalAffiliation: false,
      OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }],
    },
  });
  console.log(`  OBL or ASC-affiliated:              ${oblOrAsc.toLocaleString().padStart(6)}`);
  console.log(`    …filtered to actively billing IR: ${activeOblOrAsc.toLocaleString().padStart(6)}`);
  console.log(`    …filtered to NOT hospital-only:   ${pureOblOrAsc.toLocaleString().padStart(6)}`);

  // --- Geography
  console.log("\n── Top 10 states (practice location) ──");
  const states = await prisma.physicianAddress.groupBy({
    by: ["state"],
    where: { kind: "practice", state: { not: null } },
    _count: { npi: true },
    orderBy: { _count: { npi: "desc" } },
    take: 10,
  });
  for (const s of states) {
    console.log(`  ${s.state}  ${s._count.npi.toLocaleString().padStart(5)}`);
  }

  console.log("\n── Top 10 metros (CBSA) ──");
  const metros = await prisma.physicianAddress.groupBy({
    by: ["cbsaName"],
    where: { kind: "practice", cbsaName: { not: null } },
    _count: { npi: true },
    orderBy: { _count: { npi: "desc" } },
    take: 10,
  });
  for (const m of metros) {
    console.log(`  ${m._count.npi.toString().padStart(4)}  ${m.cbsaName}`);
  }

  console.log("\n── Quick links ──");
  console.log("  http://localhost:3000/                              all 11,556 IRs");
  console.log("  http://localhost:3000/?active=1                     2,784 billing Medicare");
  console.log("  http://localhost:3000/?oblasc=1&active=1            1,715 commercial-TAM");
  console.log("  http://localhost:3000/?state=TX&oblasc=1            TX OBL+ASC");
  console.log("  http://localhost:3000/?cbsa=35620&asc=1             NYC metro, ASC-affiliated");
  console.log("  http://localhost:3000/api/export?active=1           CSV export, active only");
  console.log("  npm run db:studio                                    Prisma Studio browser\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

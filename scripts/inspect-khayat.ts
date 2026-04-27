import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const p = await prisma.physician.findUnique({
    where: { npi: "1780941583" },
    include: {
      addresses: true,
      affiliations: { include: { facility: true } },
      procedures: true,
      persona: true,
      outreach: true,
      facts: { where: { supersededById: null } },
    },
  });
  if (!p) {
    console.log("Not found");
    return;
  }
  console.log("=== Mamdouh Khayat (NPI 1780941583) ===");
  console.log(`isActiveIr=${p.isActiveIr}  practiceSetting=${p.practiceSetting}`);
  console.log(`  Office services: ${p.irOfficeServices ?? 0}    Facility services: ${p.irFacilityServices ?? 0}`);
  console.log(`hasHospitalAffiliation=${p.hasHospitalAffiliation}  hasAscAffiliation=${p.hasAscAffiliation}`);
  console.log(`Categories: ${p.activeIrCategories.join(", ")}`);
  console.log(`Total IR services: ${p.totalIrServices}  distinct CPTs: ${p.distinctIrCpts}`);
  console.log(`\nPractice addresses:`);
  for (const a of p.addresses.filter((x) => x.kind === "practice")) {
    console.log(`  ${a.line1}, ${a.city}, ${a.state} ${a.postalCode}`);
  }
  console.log(`\nPUF procedures (${p.procedures.length} rows):`);
  for (const pv of p.procedures) {
    console.log(`  ${pv.year} ${pv.cpt} (${pv.category}) POS=${pv.placeOfService} services=${pv.totServices}`);
  }
  console.log(`\nFacility affiliations (${p.affiliations.length}):`);
  for (const a of p.affiliations) {
    console.log(`  [${a.facility.kind}] CCN=${a.ccn} ${a.facility.name} (${a.facility.city}, ${a.facility.state} ${a.facility.postalCode})  source=${a.source}`);
  }
  console.log(`\nPersona: ${p.persona?.archetype ?? "none"}  conf=${p.persona?.archetypeConfidence ?? "?"}`);
  console.log(`Hook: ${p.persona?.hookSummary ?? "—"}`);
  console.log(`\nOutreach stage: ${p.outreach?.stage ?? "—"}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

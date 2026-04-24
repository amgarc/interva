// Derives practiceSetting on each Physician from the PUF Place_Of_Srvc mix.
//
//   "OBL"       >75% of IR services billed with POS="O" (office-based lab)
//   "FACILITY"  >75% with POS="F" (hospital, ASC, or other facility)
//   "MIXED"     otherwise
//   null        no PUF data
//
// Note: PUF aggregates ASC + hospital into "F". Distinguishing ASC from hospital
// requires joining CMS ASC CCN data (a future enrichment).
//
// Usage:
//   npm run derive:practice-setting

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OBL_THRESHOLD = 0.75;
const FACILITY_THRESHOLD = 0.75;

async function main() {
  console.log("Deriving practiceSetting from PUF Place_Of_Srvc mix...");

  // One-pass UPDATE using a per-NPI aggregate of office-vs-facility services.
  const updated = await prisma.$executeRaw`
    UPDATE "Physician" p SET
      "irOfficeServices"   = stats.office_svcs,
      "irFacilityServices" = stats.facility_svcs,
      "practiceSetting"    = CASE
        WHEN stats.total = 0 THEN NULL
        WHEN stats.office_svcs::float   / stats.total >= ${OBL_THRESHOLD}      THEN 'OBL'
        WHEN stats.facility_svcs::float / stats.total >= ${FACILITY_THRESHOLD} THEN 'FACILITY'
        ELSE 'MIXED'
      END
    FROM (
      SELECT
        npi,
        COALESCE(SUM("totServices") FILTER (WHERE "placeOfService" = 'O'), 0)::int AS office_svcs,
        COALESCE(SUM("totServices") FILTER (WHERE "placeOfService" = 'F'), 0)::int AS facility_svcs,
        COALESCE(SUM("totServices") FILTER (WHERE "placeOfService" IN ('O', 'F')), 0)::int AS total
      FROM "ProcedureVolume"
      GROUP BY npi
    ) stats
    WHERE p.npi = stats.npi
  `;
  console.log(`  Updated ${updated.toLocaleString()} physicians`);

  // Reset physicians with no PUF rows to NULL.
  await prisma.$executeRaw`
    UPDATE "Physician" p SET
      "irOfficeServices"   = NULL,
      "irFacilityServices" = NULL,
      "practiceSetting"    = NULL
    WHERE NOT EXISTS (SELECT 1 FROM "ProcedureVolume" pv WHERE pv.npi = p.npi)
  `;

  console.log("\n=== Practice setting distribution ===");
  for (const setting of ["OBL", "FACILITY", "MIXED"] as const) {
    const n = await prisma.physician.count({ where: { practiceSetting: setting } });
    console.log(`  ${setting.padEnd(10)} ${n.toLocaleString()}`);
  }
  const noPuf = await prisma.physician.count({ where: { practiceSetting: null } });
  console.log(`  ${"no PUF".padEnd(10)} ${noPuf.toLocaleString()}`);

  console.log("\n=== Active IR × practice setting ===");
  for (const setting of ["OBL", "FACILITY", "MIXED"] as const) {
    const n = await prisma.physician.count({
      where: { practiceSetting: setting, isActiveIr: true },
    });
    console.log(`  active IR + ${setting.padEnd(10)} ${n.toLocaleString()}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

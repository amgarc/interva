// Backfills cbsaCode + cbsaName + cbsaType on every PhysicianAddress by:
//   1. Populating the ZipMetro lookup table from Census ZCTA↔County + OMB
//      CBSA delineation.
//   2. Running a single bulk UPDATE PhysicianAddress ... FROM "ZipMetro"
//      (avoids 20K per-row round-trips that blow up Neon's connection limits).
//
// Sources (no authentication required):
//   reference/cbsa_delineation_2023.csv
//     OMB 2023 CBSA delineation (Bulletin 23-01), converted from official XLSX.
//   data/geo/zcta_county_2020.txt
//     Census 2020 ZCTA520 ↔ County20 relationship file, pipe-delimited.
//     Download: https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
//
// Usage:
//   npm run backfill:metros

import { parse } from "csv-parse";
import { createReadStream, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";
import path from "path";

const prisma = new PrismaClient();

const REPO_ROOT = path.resolve(__dirname, "..");
const CBSA_CSV = path.join(REPO_ROOT, "reference/cbsa_delineation_2023.csv");
const ZCTA_TXT = path.join(REPO_ROOT, "data/geo/zcta_county_2020.txt");
const ZCTA_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";

interface CbsaInfo {
  cbsaCode: string;
  cbsaName: string;
  cbsaType: "METRO" | "MICRO";
}

async function loadCountyToCbsa(): Promise<Map<string, CbsaInfo>> {
  if (!existsSync(CBSA_CSV)) throw new Error(`Missing ${CBSA_CSV}`);
  const out = new Map<string, CbsaInfo>();
  const parser = createReadStream(CBSA_CSV).pipe(
    parse({ columns: true, skip_empty_lines: true, bom: true }),
  );
  for await (const row of parser) {
    const code = (row["CBSA Code"] ?? "").trim();
    const name = (row["CBSA Title"] ?? "").trim();
    const kind = (row["Metropolitan/Micropolitan Statistical Area"] ?? "").trim();
    const stFips = (row["FIPS State Code"] ?? "").trim();
    const coFips = (row["FIPS County Code"] ?? "").trim();
    if (!code || !name || !stFips || !coFips) continue;
    const county = stFips.padStart(2, "0") + coFips.padStart(3, "0");
    out.set(county, {
      cbsaCode: code,
      cbsaName: name,
      cbsaType: kind.toLowerCase().startsWith("metro") ? "METRO" : "MICRO",
    });
  }
  return out;
}

async function loadZipToCbsa(
  countyToCbsa: Map<string, CbsaInfo>,
): Promise<Map<string, CbsaInfo>> {
  if (!existsSync(ZCTA_TXT)) {
    throw new Error(
      `Missing ${ZCTA_TXT}\nDownload first:\n  curl -L -o "${ZCTA_TXT}" "${ZCTA_URL}"`,
    );
  }
  const zctaBest = new Map<string, { county: string; area: number }>();
  const parser = createReadStream(ZCTA_TXT).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      delimiter: "|",
      bom: true,
      relax_quotes: true,
    }),
  );
  for await (const row of parser) {
    const zcta = (row["GEOID_ZCTA5_20"] ?? "").trim();
    const county = (row["GEOID_COUNTY_20"] ?? "").trim();
    const area = Number(row["AREALAND_PART"] ?? 0) || 0;
    if (!zcta || !county) continue;
    const prev = zctaBest.get(zcta);
    if (!prev || area > prev.area) zctaBest.set(zcta, { county, area });
  }
  const out = new Map<string, CbsaInfo>();
  for (const [zcta, { county }] of zctaBest) {
    const cbsa = countyToCbsa.get(county);
    if (cbsa) out.set(zcta, cbsa);
  }
  return out;
}

async function populateZipMetroTable(zipToCbsa: Map<string, CbsaInfo>): Promise<void> {
  console.log(`Populating ZipMetro with ${zipToCbsa.size.toLocaleString()} rows...`);
  await prisma.zipMetro.deleteMany();
  const all = Array.from(zipToCbsa.entries()).map(([zip, info]) => ({
    zip,
    cbsaCode: info.cbsaCode,
    cbsaName: info.cbsaName,
    cbsaType: info.cbsaType,
  }));
  const BATCH = 2000;
  for (let i = 0; i < all.length; i += BATCH) {
    await prisma.zipMetro.createMany({ data: all.slice(i, i + BATCH), skipDuplicates: true });
    console.log(`  Inserted ${Math.min(i + BATCH, all.length).toLocaleString()} / ${all.length.toLocaleString()}`);
  }
}

async function main(): Promise<void> {
  console.log("Loading OMB CBSA delineation...");
  const countyToCbsa = await loadCountyToCbsa();
  console.log(`  ${countyToCbsa.size.toLocaleString()} county→CBSA rows`);

  console.log("Loading Census ZCTA↔County crosswalk...");
  const zipToCbsa = await loadZipToCbsa(countyToCbsa);
  console.log(`  ${zipToCbsa.size.toLocaleString()} ZIP→CBSA entries`);

  await populateZipMetroTable(zipToCbsa);

  console.log("\nBackfilling PhysicianAddress via single bulk UPDATE JOIN...");
  const run = await prisma.ingestRun.create({
    data: { source: "CENSUS_ZCTA_CBSA", filename: ZCTA_TXT, status: "running" },
  });
  const startedAt = Date.now();

  try {
    // NPPES stores ZIP+4 without a dash (e.g., "432021579"). Plain LEFT(,5)
    // is indexable and works for all valid US ZIP rows. Skip where length < 5.
    const matched = await prisma.$executeRaw`
      UPDATE "PhysicianAddress" a
      SET "cbsaCode" = zm."cbsaCode",
          "cbsaName" = zm."cbsaName",
          "cbsaType" = zm."cbsaType"
      FROM "ZipMetro" zm
      WHERE a."postalCode" IS NOT NULL
        AND LENGTH(a."postalCode") >= 5
        AND zm.zip = LEFT(a."postalCode", 5)
    `;
    console.log(`  Matched ${matched.toLocaleString()} rows`);

    // Clear any address whose ZIP doesn't map to a CBSA (rural or bad ZIP).
    const cleared = await prisma.$executeRaw`
      UPDATE "PhysicianAddress" a
      SET "cbsaCode" = NULL, "cbsaName" = NULL, "cbsaType" = NULL
      WHERE a."cbsaCode" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ZipMetro" zm
          WHERE a."postalCode" IS NOT NULL
            AND LENGTH(a."postalCode") >= 5
            AND zm.zip = LEFT(a."postalCode", 5)
        )
    `;
    if (cleared > 0) console.log(`  Cleared ${cleared.toLocaleString()} stale mappings`);

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        rowsMatched: matched,
        rowsUpserted: matched,
      },
    });

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`\nDone in ${elapsed}s.`);

    const practiceMapped = await prisma.physicianAddress.count({
      where: { kind: "practice", cbsaCode: { not: null } },
    });
    const practiceTotal = await prisma.physicianAddress.count({ where: { kind: "practice" } });
    console.log(
      `\nPractice addresses with a CBSA: ${practiceMapped.toLocaleString()} / ${practiceTotal.toLocaleString()} (${((practiceMapped / practiceTotal) * 100).toFixed(1)}%)`,
    );

    // Top 10 metros by IR practice concentration.
    console.log(`\n=== Top 10 metros by practice addresses ===`);
    const top = await prisma.physicianAddress.groupBy({
      by: ["cbsaName"],
      where: { kind: "practice", cbsaCode: { not: null } },
      _count: { npi: true },
      orderBy: { _count: { npi: "desc" } },
      take: 10,
    });
    for (const t of top) {
      console.log(`  ${t._count.npi.toString().padStart(4)}  ${t.cbsaName}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), error: msg },
    });
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

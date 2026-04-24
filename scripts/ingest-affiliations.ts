// Ingests physician↔facility affiliations from two sources:
//
// 1. CMS Facility_Affiliation.csv — hospitals + post-acute facilities
//    (LTCH/IRF/SNF/HH/Hospice/Dialysis). Physician-self-reported via PECOS.
//    ~1.6M rows; we filter to our ~11K IR NPIs, typically yielding 20-50K
//    affiliation rows.
//
// 2. ASC address matching — ASC_Facility.csv lacks street addresses but has
//    (city, state, ZIP5). For each IR practice address, we check if there's
//    an ASC in the same (city-upper, state, ZIP5). Matches are inserted as
//    PhysicianAffiliation rows with source="INFERRED_ZIP_CITY".
//
// Usage:
//   npm run ingest:affiliations

import { parse } from "csv-parse";
import { createReadStream, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";
import path from "path";

const prisma = new PrismaClient();

const REPO_ROOT = path.resolve(__dirname, "..");
const AFFIL_CSV = path.join(REPO_ROOT, "data/cms/Facility_Affiliation.csv");

const emptyToNull = (s: string | undefined | null): string | null => {
  if (s == null) return null;
  const t = s.trim();
  return t === "" ? null : t;
};

const upperTrim = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();
const zip5 = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "").slice(0, 5);

async function ingestCmsAffiliations(irNpis: Set<string>, knownCcns: Set<string>) {
  if (!existsSync(AFFIL_CSV)) throw new Error(`Missing ${AFFIL_CSV}`);
  console.log("Streaming Facility_Affiliation.csv and filtering to IR NPIs...");

  const parser = createReadStream(AFFIL_CSV).pipe(
    parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true }),
  );

  // Dedupe (npi, ccn) within this run.
  const seen = new Set<string>();
  const batch: Array<{
    npi: string;
    ccn: string;
    source: string;
    indPacId: string | null;
    parentCcn: string | null;
  }> = [];
  const BATCH_SIZE = 1000;
  let rowsRead = 0;
  let rowsMatched = 0;
  let rowsInserted = 0;
  let skippedUnknownCcn = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await prisma.physicianAffiliation.createMany({
      data: batch,
      skipDuplicates: true,
    });
    rowsInserted += result.count;
    batch.length = 0;
  };

  for await (const row of parser) {
    rowsRead++;
    if (rowsRead % 500000 === 0) {
      console.log(`  read=${rowsRead.toLocaleString()} matched=${rowsMatched.toLocaleString()}`);
    }
    const npi = emptyToNull(row["NPI"]);
    const ccn = emptyToNull(row["Facility Affiliations Certification Number"]);
    if (!npi || !ccn) continue;
    if (!irNpis.has(npi)) continue;
    if (!knownCcns.has(ccn)) {
      skippedUnknownCcn++;
      continue;
    }
    const key = `${npi}|${ccn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rowsMatched++;
    batch.push({
      npi,
      ccn,
      source: "CMS_FACILITY_AFFILIATION",
      indPacId: emptyToNull(row["Ind_PAC_ID"]),
      parentCcn: null,
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(
    `  CMS: read=${rowsRead.toLocaleString()} matched=${rowsMatched.toLocaleString()} inserted=${rowsInserted.toLocaleString()} unknown-ccn=${skippedUnknownCcn.toLocaleString()}`,
  );
  return { rowsMatched, rowsInserted };
}

async function ingestAscAffiliationsByAddress() {
  console.log("\nMatching IR practice addresses to ASC ZIP+city...");
  const ascs = await prisma.facility.findMany({
    where: { kind: "ASC" },
    select: { ccn: true, state: true, city: true, postalCode: true },
  });
  // Key: "STATE|CITY_UPPER|ZIP5" → list of CCNs
  const ascIndex = new Map<string, string[]>();
  for (const a of ascs) {
    const key = `${upperTrim(a.state)}|${upperTrim(a.city)}|${zip5(a.postalCode)}`;
    if (!key.split("|").every((p) => p.length > 0)) continue;
    const list = ascIndex.get(key) ?? [];
    list.push(a.ccn);
    ascIndex.set(key, list);
  }
  console.log(`  ASC address index: ${ascIndex.size.toLocaleString()} (state,city,ZIP) keys`);

  const addresses = await prisma.physicianAddress.findMany({
    where: { kind: "practice" },
    select: { npi: true, state: true, city: true, postalCode: true },
  });

  const toInsert: Array<{
    npi: string;
    ccn: string;
    source: string;
    indPacId: null;
    parentCcn: null;
  }> = [];
  const seenPair = new Set<string>();
  for (const addr of addresses) {
    const key = `${upperTrim(addr.state)}|${upperTrim(addr.city)}|${zip5(addr.postalCode)}`;
    const matches = ascIndex.get(key);
    if (!matches) continue;
    for (const ccn of matches) {
      const pk = `${addr.npi}|${ccn}`;
      if (seenPair.has(pk)) continue;
      seenPair.add(pk);
      toInsert.push({ npi: addr.npi, ccn, source: "INFERRED_ZIP_CITY", indPacId: null, parentCcn: null });
    }
  }

  console.log(`  Inferred ASC affiliations to insert: ${toInsert.length.toLocaleString()}`);
  const BATCH = 1000;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH);
    const r = await prisma.physicianAffiliation.createMany({ data: slice, skipDuplicates: true });
    inserted += r.count;
  }
  console.log(`  ASC: inserted ${inserted.toLocaleString()} inferred affiliations`);
  return { rowsMatched: toInsert.length, rowsInserted: inserted };
}

async function deriveBooleans() {
  console.log("\nDeriving hasHospitalAffiliation + hasAscAffiliation flags...");
  const hosp = await prisma.$executeRaw`
    UPDATE "Physician" p SET
      "hasHospitalAffiliation" = EXISTS (
        SELECT 1 FROM "PhysicianAffiliation" pa
        JOIN "Facility" f ON f.ccn = pa.ccn
        WHERE pa.npi = p.npi AND f.kind = 'HOSPITAL'
      ),
      "hasAscAffiliation" = EXISTS (
        SELECT 1 FROM "PhysicianAffiliation" pa
        JOIN "Facility" f ON f.ccn = pa.ccn
        WHERE pa.npi = p.npi AND f.kind = 'ASC'
      )
  `;
  console.log(`  Updated ${hosp.toLocaleString()} physicians`);
}

async function main(): Promise<void> {
  // Wipe existing affiliations so this script is idempotent.
  console.log("Wiping previous PhysicianAffiliation rows...");
  const wiped = await prisma.physicianAffiliation.deleteMany();
  if (wiped.count > 0) console.log(`  Wiped ${wiped.count.toLocaleString()} rows`);

  console.log("Loading IR NPI set + known CCN set...");
  const [physicians, facilities] = await Promise.all([
    prisma.physician.findMany({ select: { npi: true } }),
    prisma.facility.findMany({ select: { ccn: true } }),
  ]);
  const irNpis = new Set(physicians.map((p) => p.npi));
  const knownCcns = new Set(facilities.map((f) => f.ccn));
  console.log(`  ${irNpis.size.toLocaleString()} IR NPIs, ${knownCcns.size.toLocaleString()} known CCNs`);

  const run = await prisma.ingestRun.create({
    data: { source: "CMS_AFFILIATIONS", filename: AFFIL_CSV, status: "running" },
  });
  const startedAt = Date.now();

  try {
    const cms = await ingestCmsAffiliations(irNpis, knownCcns);
    const asc = await ingestAscAffiliationsByAddress();
    await deriveBooleans();

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        rowsMatched: cms.rowsMatched + asc.rowsMatched,
        rowsUpserted: cms.rowsInserted + asc.rowsInserted,
      },
    });

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`\nDone in ${elapsed}s.`);

    // Summary.
    console.log("\n=== Affiliation summary ===");
    const withHosp = await prisma.physician.count({ where: { hasHospitalAffiliation: true } });
    const withAsc = await prisma.physician.count({ where: { hasAscAffiliation: true } });
    const withBoth = await prisma.physician.count({
      where: { hasHospitalAffiliation: true, hasAscAffiliation: true },
    });
    const withAscOnly = await prisma.physician.count({
      where: { hasAscAffiliation: true, hasHospitalAffiliation: false },
    });
    console.log(`  Hospital-affiliated:        ${withHosp.toLocaleString()}`);
    console.log(`  ASC-affiliated (inferred):  ${withAsc.toLocaleString()}`);
    console.log(`  Both:                       ${withBoth.toLocaleString()}`);
    console.log(`  ASC only (no hospital):     ${withAscOnly.toLocaleString()}`);

    console.log("\n=== OBL + ASC addressable market ===");
    const oblOnly = await prisma.physician.count({ where: { practiceSetting: "OBL" } });
    const ascAffiliated = await prisma.physician.count({
      where: { hasAscAffiliation: true },
    });
    const oblOrAsc = await prisma.physician.count({
      where: { OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }] },
    });
    const activeOblOrAsc = await prisma.physician.count({
      where: { isActiveIr: true, OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }] },
    });
    console.log(`  OBL (PUF POS-derived):                  ${oblOnly.toLocaleString()}`);
    console.log(`  ASC-affiliated (inferred ZIP+city):     ${ascAffiliated.toLocaleString()}`);
    console.log(`  OBL OR ASC:                             ${oblOrAsc.toLocaleString()}`);
    console.log(`  OBL OR ASC  *AND*  active IR:           ${activeOblOrAsc.toLocaleString()}`);
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

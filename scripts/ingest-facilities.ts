// Ingests CMS hospital + ASC facilities into the Facility table.
//
// Sources:
//   data/cms/Hospital_General_Information.csv — every Medicare hospital
//     (~5,400 rows). Keyed by CCN (Facility ID column).
//   data/cms/ASC_Facility.csv — every Medicare ASC reporting quality measures
//     (~5,700 rows). Keyed by CCN (Facility ID column); also has ASC org NPI.
//
// Idempotent: wipes both kinds first and re-inserts.

import { parse } from "csv-parse";
import { createReadStream, existsSync } from "fs";
import { PrismaClient } from "@prisma/client";
import path from "path";

const prisma = new PrismaClient();

const REPO_ROOT = path.resolve(__dirname, "..");
const HOSPITAL_CSV = path.join(REPO_ROOT, "data/cms/Hospital_General_Information.csv");
const ASC_CSV = path.join(REPO_ROOT, "data/cms/ASC_Facility.csv");

const emptyToNull = (s: string | undefined | null): string | null => {
  if (s == null) return null;
  const t = s.trim();
  return t === "" || t === "Not Available" ? null : t;
};

interface FacilityRow {
  ccn: string;
  name: string;
  kind: string;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  ownership: string | null;
  hospitalType: string | null;
}

async function readHospitals(): Promise<FacilityRow[]> {
  if (!existsSync(HOSPITAL_CSV)) throw new Error(`Missing ${HOSPITAL_CSV}`);
  const out: FacilityRow[] = [];
  const parser = createReadStream(HOSPITAL_CSV).pipe(
    parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true }),
  );
  for await (const row of parser) {
    const ccn = emptyToNull(row["Facility ID"]);
    const name = emptyToNull(row["Facility Name"]);
    if (!ccn || !name) continue;
    out.push({
      ccn,
      name,
      kind: "HOSPITAL",
      address1: emptyToNull(row["Address"]),
      city: emptyToNull(row["City/Town"] ?? row["City"]),
      state: emptyToNull(row["State"]),
      postalCode: emptyToNull(row["ZIP Code"]),
      ownership: emptyToNull(row["Hospital Ownership"]),
      hospitalType: emptyToNull(row["Hospital Type"]),
    });
  }
  return out;
}

async function readAscs(): Promise<FacilityRow[]> {
  if (!existsSync(ASC_CSV)) throw new Error(`Missing ${ASC_CSV}`);
  // Collapse duplicates: the ASC Quality file has one row per ASC per year;
  // we only want one row per CCN. Keep the most recent year.
  const byCcn = new Map<string, { year: number; row: FacilityRow }>();
  const parser = createReadStream(ASC_CSV).pipe(
    parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true }),
  );
  for await (const row of parser) {
    const ccn = emptyToNull(row["Facility ID"]);
    const name = emptyToNull(row["Facility Name"]);
    if (!ccn || !name) continue;
    const year = parseInt(emptyToNull(row["Year"]) ?? "0", 10);
    const existing = byCcn.get(ccn);
    if (existing && existing.year >= year) continue;
    byCcn.set(ccn, {
      year,
      row: {
        ccn,
        name,
        kind: "ASC",
        address1: null, // not in the quality file
        city: emptyToNull(row["City/Town"]),
        state: emptyToNull(row["State"]),
        postalCode: emptyToNull(row["ZIP Code"]),
        ownership: null,
        hospitalType: null,
      },
    });
  }
  return Array.from(byCcn.values()).map((v) => v.row);
}

async function upsertBatch(rows: FacilityRow[]): Promise<void> {
  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await prisma.$transaction(
      slice.map((f) =>
        prisma.facility.upsert({
          where: { ccn: f.ccn },
          create: f,
          update: f,
        }),
      ),
    );
  }
}

async function main(): Promise<void> {
  const run = await prisma.ingestRun.create({
    data: { source: "CMS_FACILITIES", status: "running" },
  });
  const startedAt = Date.now();

  try {
    console.log("Reading Hospital_General_Information.csv...");
    const hospitals = await readHospitals();
    console.log(`  ${hospitals.length.toLocaleString()} hospitals`);

    console.log("Reading ASC_Facility.csv...");
    const ascs = await readAscs();
    console.log(`  ${ascs.length.toLocaleString()} ASCs`);

    // Wipe only rows we're about to re-insert; leave other kinds alone.
    await prisma.facility.deleteMany({ where: { kind: { in: ["HOSPITAL", "ASC"] } } });

    console.log("Upserting hospitals...");
    await upsertBatch(hospitals);
    console.log("Upserting ASCs...");
    await upsertBatch(ascs);

    const total = hospitals.length + ascs.length;
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        rowsRead: total,
        rowsMatched: total,
        rowsUpserted: total,
      },
    });

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`\nDone in ${elapsed}s.`);

    const hospitalCount = await prisma.facility.count({ where: { kind: "HOSPITAL" } });
    const ascCount = await prisma.facility.count({ where: { kind: "ASC" } });
    console.log(`  Facilities in DB: ${hospitalCount.toLocaleString()} hospitals, ${ascCount.toLocaleString()} ASCs`);
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

// NPPES bulk-file ingest. Streams a ~10GB CSV line-by-line, filters to rows
// whose taxonomy_1..15 includes an IR code, and upserts into Postgres.
//
// Usage:
//   npm run ingest:nppes -- /path/to/npidata_pfile_YYYYMMDD-YYYYMMDD.csv
// Or set NPPES_CSV_PATH in .env.
//
// Get the monthly file from https://download.cms.gov/nppes/NPI_Files.html
// (V2 format required as of 2026-03-03).

import { parse } from "csv-parse";
import { createReadStream, existsSync, statSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { IR_TAXONOMIES, IR_TAXONOMY_CODES } from "../src/lib/taxonomies";

const prisma = new PrismaClient();
const TAXONOMY_SLOTS = 15;
const IR_CODE_SET: ReadonlySet<string> = new Set(IR_TAXONOMY_CODES);
const TAXONOMY_NAMES = IR_TAXONOMIES as Record<string, string>;

type AddressKind = "mailing" | "practice";

interface PhysicianRecord {
  npi: string;
  entityTypeCode: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  namePrefix: string | null;
  nameSuffix: string | null;
  credentials: string | null;
  gender: string | null;
  soleProprietor: string | null;
  enumerationDate: Date | null;
  lastUpdatedDate: Date | null;
  deactivationDate: Date | null;
  deactivationReason: string | null;
  taxonomies: {
    code: string;
    name: string | null;
    license: string | null;
    licenseState: string | null;
    isPrimary: boolean;
    slot: number;
  }[];
  addresses: {
    kind: AddressKind;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string;
    phone: string | null;
    fax: string | null;
  }[];
}

function emptyToNull(s: string | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

// NPPES dates are "MM/DD/YYYY".
function parseNppesDate(s: string | undefined): Date | null {
  const t = emptyToNull(s);
  if (!t) return null;
  const [mm, dd, yyyy] = t.split("/");
  if (!mm || !dd || !yyyy) return null;
  const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function rowToPhysician(row: Record<string, string>): PhysicianRecord | null {
  // Entity Type Code: 1 = individual, 2 = org. Orgs aren't target physicians.
  if (row["Entity Type Code"] !== "1") return null;

  const taxonomies: PhysicianRecord["taxonomies"] = [];
  let matchesIr = false;
  for (let i = 1; i <= TAXONOMY_SLOTS; i++) {
    const code = emptyToNull(row[`Healthcare Provider Taxonomy Code_${i}`]);
    if (!code) continue;
    if (IR_CODE_SET.has(code)) matchesIr = true;
    taxonomies.push({
      code,
      name: TAXONOMY_NAMES[code] ?? null,
      license: emptyToNull(row[`Provider License Number_${i}`]),
      licenseState: emptyToNull(row[`Provider License Number State Code_${i}`]),
      isPrimary: row[`Healthcare Provider Primary Taxonomy Switch_${i}`] === "Y",
      slot: i,
    });
  }
  if (!matchesIr) return null;

  const npi = emptyToNull(row["NPI"]);
  if (!npi) return null;

  const addresses: PhysicianRecord["addresses"] = [];
  const mailingLine1 = emptyToNull(row["Provider First Line Business Mailing Address"]);
  if (mailingLine1) {
    addresses.push({
      kind: "mailing",
      line1: mailingLine1,
      line2: emptyToNull(row["Provider Second Line Business Mailing Address"]),
      city: emptyToNull(row["Provider Business Mailing Address City Name"]),
      state: emptyToNull(row["Provider Business Mailing Address State Name"]),
      postalCode: emptyToNull(row["Provider Business Mailing Address Postal Code"]),
      country:
        emptyToNull(row["Provider Business Mailing Address Country Code (If outside U.S.)"]) ??
        "US",
      phone: emptyToNull(row["Provider Business Mailing Address Telephone Number"]),
      fax: emptyToNull(row["Provider Business Mailing Address Fax Number"]),
    });
  }
  const practiceLine1 = emptyToNull(
    row["Provider First Line Business Practice Location Address"],
  );
  if (practiceLine1) {
    addresses.push({
      kind: "practice",
      line1: practiceLine1,
      line2: emptyToNull(row["Provider Second Line Business Practice Location Address"]),
      city: emptyToNull(row["Provider Business Practice Location Address City Name"]),
      state: emptyToNull(row["Provider Business Practice Location Address State Name"]),
      postalCode: emptyToNull(row["Provider Business Practice Location Address Postal Code"]),
      country:
        emptyToNull(
          row["Provider Business Practice Location Address Country Code (If outside U.S.)"],
        ) ?? "US",
      phone: emptyToNull(row["Provider Business Practice Location Address Telephone Number"]),
      fax: emptyToNull(row["Provider Business Practice Location Address Fax Number"]),
    });
  }

  return {
    npi,
    entityTypeCode: "1",
    firstName: emptyToNull(row["Provider First Name"]),
    middleName: emptyToNull(row["Provider Middle Name"]),
    lastName: emptyToNull(row["Provider Last Name (Legal Name)"]),
    namePrefix: emptyToNull(row["Provider Name Prefix Text"]),
    nameSuffix: emptyToNull(row["Provider Name Suffix Text"]),
    credentials: emptyToNull(row["Provider Credential Text"]),
    gender: emptyToNull(row["Provider Sex Code"]),
    soleProprietor: emptyToNull(row["Is Sole Proprietor"]),
    enumerationDate: parseNppesDate(row["Provider Enumeration Date"]),
    lastUpdatedDate: parseNppesDate(row["Last Update Date"]),
    deactivationDate: parseNppesDate(row["NPI Deactivation Date"]),
    deactivationReason: emptyToNull(row["NPI Deactivation Reason Code"]),
    taxonomies,
    addresses,
  };
}

async function upsertPhysician(p: PhysicianRecord): Promise<void> {
  const { npi, taxonomies, addresses, ...scalar } = p;
  await prisma.$transaction([
    prisma.physicianTaxonomy.deleteMany({ where: { npi } }),
    prisma.physicianAddress.deleteMany({ where: { npi } }),
    prisma.physician.upsert({
      where: { npi },
      create: { npi, ...scalar },
      update: scalar,
    }),
    prisma.physicianTaxonomy.createMany({
      data: taxonomies.map((t) => ({ npi, ...t })),
    }),
    prisma.physicianAddress.createMany({
      data: addresses.map((a) => ({ npi, ...a })),
    }),
  ]);
}

async function main(): Promise<void> {
  const csvPath = process.argv[2] ?? process.env.NPPES_CSV_PATH;
  if (!csvPath) {
    console.error("Usage: npm run ingest:nppes -- /path/to/npidata_pfile.csv");
    console.error("Or set NPPES_CSV_PATH in .env");
    process.exit(1);
  }
  if (!existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const sizeGb = (statSync(csvPath).size / 1024 ** 3).toFixed(2);
  console.log(`Ingesting ${csvPath} (${sizeGb} GB)`);
  console.log(`Filtering to taxonomies: ${IR_TAXONOMY_CODES.join(", ")}`);

  const run = await prisma.ingestRun.create({
    data: { source: "NPPES", filename: csvPath, status: "running" },
  });

  let rowsRead = 0;
  let rowsMatched = 0;
  let rowsUpserted = 0;
  const startedAt = Date.now();

  try {
    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, skip_empty_lines: true, bom: true }),
    );

    for await (const row of parser) {
      rowsRead++;
      if (rowsRead % 100000 === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = Math.round(rowsRead / elapsed);
        console.log(
          `  read=${rowsRead.toLocaleString()} matched=${rowsMatched} upserted=${rowsUpserted} rate=${rate}/s`,
        );
      }
      const p = rowToPhysician(row);
      if (!p) continue;
      rowsMatched++;
      try {
        await upsertPhysician(p);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  upsert failed NPI=${p.npi}: ${msg}`);
      }
    }

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        rowsRead,
        rowsMatched,
        rowsUpserted,
      },
    });
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `Done in ${elapsed}s. read=${rowsRead.toLocaleString()} matched=${rowsMatched} upserted=${rowsUpserted}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        rowsRead,
        rowsMatched,
        rowsUpserted,
        error: msg,
      },
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

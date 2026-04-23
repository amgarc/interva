// Medicare Physician & Other Practitioners (PUF) — by Provider and Service.
// Streams a ~2.5GB CSV of ~9.5M rows, filters to rows where NPI is one of our
// IR physicians AND HCPCS is in our IR Tier-1 code set, then bulk-inserts
// into ProcedureVolume.
//
// Usage:
//   npm run ingest:puf -- /path/to/MUP_PHY_R25_P04_V20_D19_Prov_Svc.csv 2023
// Or set MEDICARE_PUF_CSV_PATH + MEDICARE_PUF_YEAR in .env.
//
// Idempotent: deletes all existing ProcedureVolume rows for the given year
// before inserting.

import { parse } from "csv-parse";
import { createReadStream, existsSync, statSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { IR_CPT_TIER_1, IR_CPT_TIER_1_CODES } from "../src/lib/ir-cpt-codes";

const prisma = new PrismaClient();
const BATCH_SIZE = 1000;

// Build CPT → category lookup once.
const CPT_CATEGORY: Record<string, string> = {};
for (const [category, codes] of Object.entries(IR_CPT_TIER_1)) {
  for (const code of Object.keys(codes)) {
    CPT_CATEGORY[code] = category;
  }
}

function toInt(s: string | undefined): number | null {
  if (!s || s.trim() === "") return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function toFloat(s: string | undefined): number | null {
  if (!s || s.trim() === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function emptyToNull(s: string | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

interface PufRecord {
  npi: string;
  year: number;
  cpt: string;
  category: string;
  placeOfService: string | null;
  totServices: number;
  totBenes: number | null;
  totBeneDaySrvcs: number | null;
  avgMdcrAllowed: number | null;
  avgMdcrPayment: number | null;
}

async function loadIrNpis(): Promise<Set<string>> {
  const rows = await prisma.physician.findMany({ select: { npi: true } });
  return new Set(rows.map((r) => r.npi));
}

async function flushBatch(batch: PufRecord[]): Promise<number> {
  if (batch.length === 0) return 0;
  const result = await prisma.procedureVolume.createMany({
    data: batch,
    skipDuplicates: true,
  });
  return result.count;
}

async function main(): Promise<void> {
  const csvPath = process.argv[2] ?? process.env.MEDICARE_PUF_CSV_PATH;
  const yearArg = process.argv[3] ?? process.env.MEDICARE_PUF_YEAR;

  if (!csvPath || !yearArg) {
    console.error("Usage: npm run ingest:puf -- /path/to/PUF.csv <year>");
    console.error("Example: npm run ingest:puf -- data/cms/MUP_PHY_R25_P04_V20_D19_Prov_Svc.csv 2023");
    process.exit(1);
  }
  if (!existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }
  const year = parseInt(yearArg, 10);
  if (isNaN(year)) {
    console.error(`Invalid year: ${yearArg}`);
    process.exit(1);
  }

  const sizeGb = (statSync(csvPath).size / 1024 ** 3).toFixed(2);
  console.log(`Ingesting Medicare PUF ${year} from ${csvPath} (${sizeGb} GB)`);

  const irNpis = await loadIrNpis();
  console.log(`Loaded ${irNpis.size.toLocaleString()} IR NPIs to filter against`);
  console.log(`Filtering to ${IR_CPT_TIER_1_CODES.size} IR Tier-1 CPT codes`);

  // Wipe existing rows for this year so the run is idempotent.
  const deleted = await prisma.procedureVolume.deleteMany({ where: { year } });
  if (deleted.count > 0) {
    console.log(`Wiped ${deleted.count.toLocaleString()} existing ProcedureVolume rows for ${year}`);
  }

  const run = await prisma.ingestRun.create({
    data: { source: "MEDICARE_PUF", filename: csvPath, status: "running" },
  });

  let rowsRead = 0;
  let rowsMatched = 0;
  let rowsInserted = 0;
  const batch: PufRecord[] = [];
  const startedAt = Date.now();

  try {
    const parser = createReadStream(csvPath).pipe(
      parse({ columns: true, skip_empty_lines: true, bom: true }),
    );

    for await (const row of parser) {
      rowsRead++;
      if (rowsRead % 500000 === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = Math.round(rowsRead / elapsed);
        console.log(
          `  read=${rowsRead.toLocaleString()} matched=${rowsMatched.toLocaleString()} inserted=${rowsInserted.toLocaleString()} rate=${rate}/s`,
        );
      }

      const npi = emptyToNull(row["Rndrng_NPI"]);
      if (!npi || !irNpis.has(npi)) continue;

      const cpt = emptyToNull(row["HCPCS_Cd"]);
      if (!cpt || !IR_CPT_TIER_1_CODES.has(cpt)) continue;

      const totServices = toInt(row["Tot_Srvcs"]);
      if (totServices == null) continue;

      rowsMatched++;
      batch.push({
        npi,
        year,
        cpt,
        category: CPT_CATEGORY[cpt]!,
        placeOfService: emptyToNull(row["Place_Of_Srvc"]),
        totServices,
        totBenes: toInt(row["Tot_Benes"]),
        totBeneDaySrvcs: toInt(row["Tot_Bene_Day_Srvcs"]),
        avgMdcrAllowed: toFloat(row["Avg_Mdcr_Alowd_Amt"]),
        avgMdcrPayment: toFloat(row["Avg_Mdcr_Pymt_Amt"]),
      });

      if (batch.length >= BATCH_SIZE) {
        rowsInserted += await flushBatch(batch);
        batch.length = 0;
      }
    }

    rowsInserted += await flushBatch(batch);

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        rowsRead,
        rowsMatched,
        rowsUpserted: rowsInserted,
      },
    });
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `Done in ${elapsed}s. read=${rowsRead.toLocaleString()} matched=${rowsMatched.toLocaleString()} inserted=${rowsInserted.toLocaleString()}`,
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
        rowsUpserted: rowsInserted,
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

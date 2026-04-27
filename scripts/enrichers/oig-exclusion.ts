// HHS-OIG List of Excluded Individuals/Entities (LEIE) — disqualifier.
//
// Source: https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv (~30K rows)
// Public domain, monthly refresh, no auth.
//
// Match on NPI column → write Fact (compliance.oig_excluded=true) + Signal
// (kind=OIG_EXCLUDED).

import { parse } from "csv-parse";
import { Readable } from "stream";
import { PrismaClient } from "@prisma/client";
import {
  writeFacts,
  writeSignals,
  markSourceRunStart,
  markSourceRunSuccess,
} from "./base";

const SOURCE_KEY = "OIG_EXCLUSION_LIST";
// OIG publishes the full LEIE database as monthly downloads. UPDATED.csv is
// the latest supplement; full database is named with the month/year.
const URL_CANDIDATES = [
  "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv",
  "https://oig.hhs.gov/sites/default/files/exclusions/UPDATED.csv",
];
const FRESHNESS_HOURS = 720;

// OIG sometimes serves an incomplete cert chain. Allow this single govt
// source to bypass strict verification.
import https from "https";
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

const prisma = new PrismaClient();

interface OigRow {
  LASTNAME?: string;
  FIRSTNAME?: string;
  MIDNAME?: string;
  BUSNAME?: string;
  GENERAL?: string;
  SPECIALTY?: string;
  UPIN?: string;
  NPI?: string;
  DOB?: string;
  ADDRESS?: string;
  CITY?: string;
  STATE?: string;
  ZIP?: string;
  EXCLTYPE?: string;
  EXCLDATE?: string; // YYYYMMDD
  REINDATE?: string;
  WAIVERDATE?: string;
  WVRSTATE?: string;
}

function ymd(s: string | undefined): Date | null {
  if (!s || s.length !== 8) return null;
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

export async function runEnricher(): Promise<void> {
  console.log(`[${SOURCE_KEY}] Downloading LEIE…`);
  await markSourceRunStart(prisma, SOURCE_KEY);

  const irNpis = new Set(
    (await prisma.physician.findMany({ select: { npi: true } })).map((p) => p.npi),
  );
  console.log(`[${SOURCE_KEY}] Filtering against ${irNpis.size.toLocaleString()} IR NPIs`);

  let csvText = "";
  let urlUsed = "";
  for (const url of URL_CANDIDATES) {
    try {
      // Use the legacy https module to apply our custom agent.
      csvText = await new Promise<string>((resolve, reject) => {
        https
          .get(
            url,
            {
              agent: insecureAgent,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              },
            },
            (res) => {
              if (res.statusCode !== 200) {
                reject(new Error(`status ${res.statusCode}`));
                return;
              }
              const chunks: Buffer[] = [];
              res.on("data", (c) => chunks.push(c));
              res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
              res.on("error", reject);
            },
          )
          .on("error", reject);
      });
      urlUsed = url;
      break;
    } catch (err) {
      console.log(`[${SOURCE_KEY}]   tried ${url}: ${(err as Error).message}`);
    }
  }
  if (!csvText) throw new Error("All OIG URL candidates failed");
  console.log(`[${SOURCE_KEY}] Got ${(csvText.length / 1024 / 1024).toFixed(1)}MB from ${urlUsed}`);

  const matches: { npi: string; row: OigRow }[] = [];
  await new Promise<void>((resolve, reject) => {
    const parser = parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true });
    Readable.from(csvText).pipe(parser);
    parser.on("data", (row: OigRow) => {
      const npi = row.NPI?.trim();
      if (npi && irNpis.has(npi)) matches.push({ npi, row });
    });
    parser.on("end", resolve);
    parser.on("error", reject);
  });

  console.log(`[${SOURCE_KEY}] ${matches.length.toLocaleString()} IR physicians on LEIE`);

  const facts = matches.map((m) => ({
    npi: m.npi,
    fieldPath: "compliance.oig_excluded",
    value: {
      excluded: true,
      type: m.row.EXCLTYPE ?? null,
      date: m.row.EXCLDATE ? ymd(m.row.EXCLDATE)?.toISOString() : null,
      specialty: m.row.SPECIALTY ?? null,
    },
    valueText: "excluded",
    sourceUrl: urlUsed,
    confidence: 0.99,
  }));

  const { written, ids } = await writeFacts(prisma, SOURCE_KEY, facts, FRESHNESS_HOURS);
  console.log(`[${SOURCE_KEY}] Wrote ${written} compliance Facts`);

  // Spawn signal per match.
  const signals = matches.map((m) => ({
    npi: m.npi,
    kind: "OIG_EXCLUDED",
    occurredAt: ymd(m.row.EXCLDATE) ?? new Date(),
    summary: `OIG-excluded (${m.row.EXCLTYPE ?? "unknown reason"})`,
    sourceFactId: ids.get(`${m.npi}|compliance.oig_excluded`),
  }));
  const sigCount = await writeSignals(prisma, signals);
  console.log(`[${SOURCE_KEY}] Wrote ${sigCount} signals`);

  await markSourceRunSuccess(prisma, SOURCE_KEY);
  console.log(`[${SOURCE_KEY}] Done.`);
}

if (require.main === module) {
  runEnricher()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

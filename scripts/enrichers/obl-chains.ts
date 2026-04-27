// OBL chain roster enricher — catches IRs whose CMS-derived practice setting
// looks "hospital" but who actually practice at a known OBL/ASC chain. Scrapes
// each chain's public provider/team page and matches names against our IR
// physician table.
//
// Chains tracked (free-source, public roster pages):
//   - Vive Vascular              vivevascular.com
//   - IR Centers / Prostate Centers   ircenters.com, prostatecenters.com
//   - USA Vein Clinics            usaveinclinics.com
//   - USA Fibroid Centers         usafibroidcenters.com
//   - Azura Vascular Care         azuravascularcare.com
//   - Modern Vascular             modernvascular.com
//   - Center for Vascular Medicine  cvmus.com
//
// Output:
//   Fact (path="practice.obl_chain", value={chain, url})
//   OutreachSignal (kind="OBL_CHAIN_MEMBER")
//   Sets Physician.hasAscAffiliation=true so OBL/ASC filters surface them.

import { PrismaClient } from "@prisma/client";
import {
  writeFacts,
  writeSignals,
  markSourceRunStart,
  markSourceRunSuccess,
  sleep,
} from "./base";

const SOURCE_KEY = "OBL_CHAIN_ROSTER";
const FRESHNESS_HOURS = 720;

const prisma = new PrismaClient();

interface ChainConfig {
  name: string;
  rosterUrls: string[];
  // Optional: path inside HTML where names appear; if omitted, we scan whole page
  nameRegex?: RegExp;
}

const CHAINS: ChainConfig[] = [
  {
    name: "Vive Vascular",
    rosterUrls: ["https://www.vivevascular.com/meet-our-vascular-doctors"],
  },
  {
    name: "IR Centers",
    rosterUrls: ["https://www.ircenters.com/providers"],
  },
  {
    name: "Prostate Centers",
    rosterUrls: ["https://www.prostatecenters.com/our-team"],
  },
  {
    name: "USA Vein Clinics",
    rosterUrls: ["https://www.usaveinclinics.com/find-a-doctor/"],
  },
  {
    name: "USA Fibroid Centers",
    rosterUrls: ["https://www.usafibroidcenters.com/find-a-doctor/"],
  },
  {
    name: "Azura Vascular Care",
    rosterUrls: ["https://www.azuravascularcare.com/our-team/"],
  },
  {
    name: "Modern Vascular",
    rosterUrls: ["https://modernvascular.com/our-doctors/"],
  },
  {
    name: "Center for Vascular Medicine",
    rosterUrls: ["https://www.cvmus.com/our-team/"],
  },
];

// Match patterns like "Dr. John Smith", "John Smith, MD", "John Smith MD",
// "John A. Smith MD". Tuned for names with capitalized first/last.
const NAME_PATTERNS = [
  /\bDr\.?\s+([A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)\s+(?:[A-Z]\.\s+)?([A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)\b/g,
  /\b([A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)\s+(?:[A-Z]\.\s+)?([A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)\s*,?\s*(?:M\.?D\.?|D\.?O\.?)\b/g,
];

function stripHtml(html: string): string {
  // Remove scripts/styles, collapse tags to spaces, decode common entities.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ");
}

function extractNames(text: string): Array<{ first: string; last: string }> {
  const out = new Map<string, { first: string; last: string }>();
  for (const re of NAME_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const first = m[1];
      const last = m[2];
      if (!first || !last) continue;
      // Skip obviously-non-name pairs.
      if (last.length < 2 || first.length < 2) continue;
      const key = `${first.toLowerCase()}|${last.toLowerCase()}`;
      if (!out.has(key)) out.set(key, { first, last });
    }
  }
  return Array.from(out.values());
}

async function fetchRoster(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return await res.text();
}

interface NameKey {
  npi: string;
  firstLower: string;
  lastLower: string;
  firstInitial: string;
}

async function buildPhysicianIndex(): Promise<Map<string, NameKey[]>> {
  // Map by lowercased last name → list of physicians with that last name.
  const rows = await prisma.physician.findMany({
    where: {
      isActiveIr: true, // restrict matches to active IRs to reduce false positives
      firstName: { not: null },
      lastName: { not: null },
    },
    select: { npi: true, firstName: true, lastName: true },
  });
  const idx = new Map<string, NameKey[]>();
  for (const p of rows) {
    if (!p.firstName || !p.lastName) continue;
    const last = p.lastName.toLowerCase().replace(/[^a-z]/g, "");
    const first = p.firstName.toLowerCase().replace(/[^a-z]/g, "");
    if (!last || !first) continue;
    const list = idx.get(last) ?? [];
    list.push({
      npi: p.npi,
      firstLower: first,
      lastLower: last,
      firstInitial: first.charAt(0),
    });
    idx.set(last, list);
  }
  return idx;
}

interface MatchHit {
  npi: string;
  chainName: string;
  url: string;
  scrapedFirst: string;
  scrapedLast: string;
}

export async function runEnricher(): Promise<void> {
  await markSourceRunStart(prisma, SOURCE_KEY);

  console.log(`[${SOURCE_KEY}] Building physician name index from active IRs…`);
  const physicianIdx = await buildPhysicianIndex();
  console.log(`[${SOURCE_KEY}]   indexed ${[...physicianIdx.values()].reduce((n, l) => n + l.length, 0).toLocaleString()} active IRs by last name`);

  const allHits: MatchHit[] = [];
  for (const chain of CHAINS) {
    for (const url of chain.rosterUrls) {
      console.log(`\n[${SOURCE_KEY}] Fetching ${chain.name} → ${url}`);
      try {
        const html = await fetchRoster(url);
        const text = stripHtml(html);
        const names = extractNames(text);
        console.log(`  parsed ${names.length} candidate names`);

        const chainHits: MatchHit[] = [];
        for (const n of names) {
          const lastLower = n.last.toLowerCase().replace(/[^a-z]/g, "");
          const firstLower = n.first.toLowerCase().replace(/[^a-z]/g, "");
          const matches = physicianIdx.get(lastLower) ?? [];
          for (const m of matches) {
            // Strict: require either exact first-name or first-initial match.
            if (m.firstLower === firstLower || m.firstInitial === firstLower.charAt(0)) {
              chainHits.push({
                npi: m.npi,
                chainName: chain.name,
                url,
                scrapedFirst: n.first,
                scrapedLast: n.last,
              });
            }
          }
        }
        // Dedupe per chain page (a name may match multiple physicians with same last/initial).
        const seen = new Set<string>();
        const deduped = chainHits.filter((h) => {
          const k = `${h.npi}|${chain.name}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        console.log(`  matched ${deduped.length} active IR physicians`);
        allHits.push(...deduped);
      } catch (err) {
        console.log(`  fetch failed: ${(err as Error).message}`);
      }
      await sleep(1500);
    }
  }

  console.log(`\n[${SOURCE_KEY}] Total hits across all chains: ${allHits.length}`);
  // Group hits by NPI so we can build one Fact per physician with their full chain list.
  const byNpi = new Map<string, MatchHit[]>();
  for (const h of allHits) {
    const list = byNpi.get(h.npi) ?? [];
    list.push(h);
    byNpi.set(h.npi, list);
  }
  console.log(`[${SOURCE_KEY}]   distinct physicians: ${byNpi.size}`);

  const facts = [];
  const signals = [];
  for (const [npi, hits] of byNpi.entries()) {
    const chains = Array.from(new Set(hits.map((h) => h.chainName)));
    facts.push({
      npi,
      fieldPath: "practice.obl_chain",
      value: hits.map((h) => ({
        chain: h.chainName,
        url: h.url,
        scrapedName: `${h.scrapedFirst} ${h.scrapedLast}`,
      })),
      valueText: chains.join("; "),
      sourceUrl: hits[0].url,
      confidence: 0.85,
    });
    signals.push({
      npi,
      kind: "OBL_CHAIN_MEMBER",
      occurredAt: new Date(),
      summary: `Listed at OBL chain: ${chains.join(", ")}`,
    });
  }

  const { written } = await writeFacts(prisma, SOURCE_KEY, facts, FRESHNESS_HOURS);
  const sigCount = await writeSignals(prisma, signals);
  console.log(`[${SOURCE_KEY}] Wrote ${written} facts / ${sigCount} signals`);

  // Flip hasAscAffiliation=true for matched physicians so OBL/ASC filters
  // surface them. Keep the data we have; this is a derived projection.
  const npis = Array.from(byNpi.keys());
  if (npis.length > 0) {
    const updated = await prisma.physician.updateMany({
      where: { npi: { in: npis } },
      data: { hasAscAffiliation: true },
    });
    console.log(`[${SOURCE_KEY}] Flipped hasAscAffiliation=true on ${updated.count} physicians`);
  }

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

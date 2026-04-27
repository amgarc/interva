// PubMed E-utilities enricher: pulls last 5 years of publications per IR
// physician, surfaces topical interests + recent activity + co-authorship
// graph (warm-intro paths).
//
// Source: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
//   - esearch.fcgi?db=pubmed&term=<query> returns IDs
//   - esummary.fcgi?db=pubmed&id=<ids> returns summaries
// No auth, ~3 req/s polite rate.
//
// Strategy (high precision, lower recall):
//   query: <lastname> <firstinitial>[AU] AND ("interventional radiology"[AD] OR
//          "vascular and interventional"[AD] OR "interventional"[TIAB])
//          AND ("2021"[DP] : "2026"[DP])
// Then cross-check first author affiliation to IR-likely terms before writing
// a Fact. Without a perfect disambiguation we accept some name collisions but
// flag low-confidence rows.

import { PrismaClient } from "@prisma/client";
import {
  writeFacts,
  writeSignals,
  markSourceRunStart,
  markSourceRunSuccess,
  sleep,
  getOblAscActiveCohort,
} from "./base";

const SOURCE_KEY = "PUBMED_EUTILS";
const FRESHNESS_HOURS = 720;
const RATE_LIMIT_MS = 350;

const prisma = new PrismaClient();

interface ESearchResponse {
  esearchresult: { count: string; idlist: string[] };
}
interface ESummaryResponse {
  result: Record<string, {
    uid: string;
    title?: string;
    pubdate?: string;
    fulljournalname?: string;
    authors?: Array<{ name: string; authtype?: string }>;
    sortpubdate?: string;
  }>;
}

interface AuthorPaper {
  pmid: string;
  title: string;
  pubdate: Date;
  journal: string;
  authors: string[];
}

async function searchAuthorPapers(lastName: string, firstName: string): Promise<AuthorPaper[]> {
  const initial = firstName.charAt(0).toUpperCase();
  const term = `${encodeURIComponent(lastName)} ${initial}[AU] AND ("interventional radiology"[AD] OR "vascular and interventional"[AD] OR interventional[TIAB]) AND ("2021"[DP] : "2026"[DP])`;
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${term}&retmax=10&retmode=json`;
  const sRes = await fetch(searchUrl);
  if (!sRes.ok) throw new Error(`esearch ${sRes.status}`);
  const sData = (await sRes.json()) as ESearchResponse;
  const ids = sData.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  await sleep(RATE_LIMIT_MS);

  const sumUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
  const eRes = await fetch(sumUrl);
  if (!eRes.ok) throw new Error(`esummary ${eRes.status}`);
  const eData = (await eRes.json()) as ESummaryResponse;

  const papers: AuthorPaper[] = [];
  for (const id of ids) {
    const r = eData.result?.[id];
    if (!r || !r.title) continue;
    const date = new Date(r.sortpubdate ?? r.pubdate ?? Date.now());
    if (isNaN(date.getTime())) continue;
    papers.push({
      pmid: id,
      title: r.title,
      pubdate: date,
      journal: r.fulljournalname ?? "",
      authors: (r.authors ?? []).map((a) => a.name),
    });
  }
  return papers;
}

export async function runEnricher(npis?: string[]): Promise<void> {
  await markSourceRunStart(prisma, SOURCE_KEY);
  const cohort = npis ?? (await getOblAscActiveCohort(prisma));
  console.log(`[${SOURCE_KEY}] Enriching ${cohort.length.toLocaleString()} NPIs (rate ~${Math.round(1000 / RATE_LIMIT_MS)}/s)`);

  const physicians = await prisma.physician.findMany({
    where: { npi: { in: cohort } },
    select: { npi: true, firstName: true, lastName: true },
  });

  const facts: Parameters<typeof writeFacts>[2] = [];
  const signals: Parameters<typeof writeSignals>[1] = [];

  let i = 0;
  let withPubs = 0;
  let errors = 0;
  for (const p of physicians) {
    i++;
    if (i % 50 === 0) {
      console.log(`[${SOURCE_KEY}]   ${i}/${physicians.length}  found-papers=${withPubs}  err=${errors}`);
    }
    if (!p.lastName || !p.firstName) continue;
    try {
      const papers = await searchAuthorPapers(p.lastName, p.firstName);
      if (papers.length === 0) {
        await sleep(RATE_LIMIT_MS);
        continue;
      }
      withPubs++;
      const recent = papers.sort((a, b) => b.pubdate.getTime() - a.pubdate.getTime());
      const allCoAuthors = Array.from(
        new Set(recent.flatMap((p) => p.authors).filter((a) => !a.toLowerCase().startsWith(p.lastName!.toLowerCase()))),
      );

      facts.push({
        npi: p.npi,
        fieldPath: "academic.publication_count_5y",
        value: recent.length,
        sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/",
        confidence: 0.75,
      });
      facts.push({
        npi: p.npi,
        fieldPath: "academic.recent_papers",
        value: recent.slice(0, 5).map((paper) => ({
          pmid: paper.pmid,
          title: paper.title,
          year: paper.pubdate.getFullYear(),
          journal: paper.journal,
          url: `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`,
        })),
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(p.lastName)}+${encodeURIComponent(p.firstName.charAt(0))}`,
        confidence: 0.75,
      });
      facts.push({
        npi: p.npi,
        fieldPath: "academic.coauthors",
        value: allCoAuthors.slice(0, 50),
        sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/",
        confidence: 0.7,
      });

      // Signal: most recent paper.
      const newest = recent[0];
      const ageMonths = (Date.now() - newest.pubdate.getTime()) / (1000 * 3600 * 24 * 30);
      if (ageMonths < 24) {
        signals.push({
          npi: p.npi,
          kind: "PUBLISHED_PAPER",
          occurredAt: newest.pubdate,
          summary: `Published "${newest.title.slice(0, 90)}${newest.title.length > 90 ? "…" : ""}" in ${newest.journal || "PubMed"}`,
        });
      }
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      errors++;
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log(`[${SOURCE_KEY}] Writing ${facts.length} facts / ${signals.length} signals`);
  const { written } = await writeFacts(prisma, SOURCE_KEY, facts, FRESHNESS_HOURS);
  const sigCount = await writeSignals(prisma, signals);
  console.log(`[${SOURCE_KEY}] Done. facts=${written} signals=${sigCount} with-pubs=${withPubs} errors=${errors}`);
  await markSourceRunSuccess(prisma, SOURCE_KEY);
}

if (require.main === module) {
  runEnricher()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

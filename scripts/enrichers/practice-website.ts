// Practice website discovery + email mining + email pattern inference.
//
// Pipeline:
//   1. DuckDuckGo HTML search for `"<Name>" "<City>" interventional radiology`
//   2. Pick top organic result, filtering aggregators (Healthgrades, Zocdoc, etc.)
//   3. Fetch the homepage + /contact, /about, /staff, /providers
//   4. Extract emails via regex; tag aggregator-domain emails as low-confidence
//   5. If no email found, infer pattern from any email seen for the same domain
//      (or fall back to common patterns: firstname.lastname@domain, etc.)
//
// All free. Aggressive timeouts so a slow site doesn't stall the run.
//
// Source key: "PRACTICE_WEBSITE_SCRAPE" + "EMAIL_PATTERN_INFERENCE"

import { PrismaClient } from "@prisma/client";
import {
  writeFacts,
  writeChannels,
  markSourceRunStart,
  markSourceRunSuccess,
  sleep,
  getOblAscActiveCohort,
} from "./base";

const SOURCE_WEB = "PRACTICE_WEBSITE_SCRAPE";
const SOURCE_EMAIL = "EMAIL_PATTERN_INFERENCE";
const FRESHNESS_HOURS = 720;
const SEARCH_DELAY_MS = 2200; // be polite to DDG
const FETCH_TIMEOUT_MS = 6000;

const prisma = new PrismaClient();

// Hosts we ignore as candidates (patient aggregators, social, video, etc.)
const AGGREGATOR_FRAGMENTS = [
  "healthgrades.com",
  "zocdoc.com",
  "vitals.com",
  "webmd.com",
  "doximity.com",
  "wellness.com",
  "yelp.com",
  "ratemds.com",
  "caredash.com",
  "usnews.com",
  "youtube.com",
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "wikipedia.org",
  "google.com",
  "doctor.com",
  "us.123rf.com",
  "yellowpages.com",
  "bbb.org",
  "medlineplus.gov",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "amazon.com",
  "indeed.com",
  "glassdoor.com",
  "betterdoctor.com",
  "uschamber.com",
  "manta.com",
  "buzzfile.com",
  "find-doctors-doctor.com",
  "physicians.us-business.info",
  "fda.gov",
  "cms.gov",
];

function isAggregator(host: string): boolean {
  return AGGREGATOR_FRAGMENTS.some((frag) => host.endsWith(frag) || host.includes(frag));
}

async function ddgSearch(query: string): Promise<string[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const candidates: string[] = [];
  // DDG HTML uses <a class="result__url" ...href="https://...">. Extract.
  const re = /<a class="result__url"[^>]*href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let raw = m[1];
    // DDG sometimes wraps in /l/?uddg=...; strip the wrapper.
    const uddg = raw.match(/uddg=([^&]+)/);
    if (uddg) raw = decodeURIComponent(uddg[1]);
    if (!raw.startsWith("http")) continue;
    candidates.push(raw);
  }
  return candidates;
}

function pickBestCandidate(urls: string[]): string | null {
  for (const u of urls) {
    try {
      const host = new URL(u).host.toLowerCase();
      if (!isAggregator(host)) return u;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchPath(host: string, path: string): Promise<string | null> {
  try {
    const url = host.replace(/\/+$/, "") + path;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; InterviewCrawler/0.1; +contact@interva.health)",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 1_000_000) return text.slice(0, 1_000_000);
    return text;
  } catch {
    return null;
  }
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function extractEmails(html: string, domainHost: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    // Skip example/spam/aggregator emails.
    if (email.endsWith(".png") || email.endsWith(".jpg") || email.endsWith(".gif")) continue;
    if (/(^example@|^noreply@|^no-reply@|@example\.|@sentry\.|@google\.|@gmail\.com$|@yahoo\.com$|@hotmail\.com$|@outlook\.com$|@aol\.com$|@protonmail\.com$|@icloud\.com$)/i.test(email)) continue;
    // Prefer emails on practice's own domain; collect others too.
    out.add(email);
  }
  return Array.from(out);
}

function inferEmailFromPattern(domain: string, firstName: string, lastName: string): string[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  if (!f || !l) return [];
  return [
    `${f}.${l}@${domain}`,
    `${f}${l}@${domain}`,
    `${f.charAt(0)}${l}@${domain}`,
    `${f.charAt(0)}.${l}@${domain}`,
    `${l}.${f}@${domain}`,
    `${l}@${domain}`,
    `${f}_${l}@${domain}`,
    `${f}@${domain}`,
  ];
}

export async function runEnricher(npis?: string[]): Promise<void> {
  await markSourceRunStart(prisma, SOURCE_WEB);
  await markSourceRunStart(prisma, SOURCE_EMAIL);
  let cohort = npis ?? (await getOblAscActiveCohort(prisma));
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0;
  if (limit > 0 && cohort.length > limit) {
    console.log(`[${SOURCE_WEB}] Limiting cohort: ${cohort.length} → ${limit} (LIMIT env)`);
    cohort = cohort.slice(0, limit);
  }
  console.log(`[${SOURCE_WEB}] Enriching ${cohort.length.toLocaleString()} NPIs (rate ~${(1000 / SEARCH_DELAY_MS).toFixed(2)}/s)`);

  const physicians = await prisma.physician.findMany({
    where: { npi: { in: cohort } },
    select: {
      npi: true,
      firstName: true,
      lastName: true,
      addresses: { where: { kind: "practice" }, select: { city: true, state: true } },
    },
  });

  const facts: Parameters<typeof writeFacts>[2] = [];
  const channels: Parameters<typeof writeChannels>[1] = [];
  const factsEmail: Parameters<typeof writeFacts>[2] = [];
  const channelsEmail: Parameters<typeof writeChannels>[1] = [];

  let i = 0;
  let withSite = 0;
  let withDirectEmail = 0;
  let withInferred = 0;
  let errors = 0;

  for (const p of physicians) {
    i++;
    if (i % 25 === 0) {
      console.log(`[${SOURCE_WEB}]   ${i}/${physicians.length}  sites=${withSite}  direct-emails=${withDirectEmail}  inferred=${withInferred}  err=${errors}`);
    }
    if (!p.firstName || !p.lastName) continue;
    const city = p.addresses[0]?.city ?? "";
    if (!city) continue;
    const query = `"${p.firstName} ${p.lastName}" "${city}" interventional radiology`;
    try {
      const candidates = await ddgSearch(query);
      const top = pickBestCandidate(candidates);
      await sleep(SEARCH_DELAY_MS);
      if (!top) continue;

      const host = new URL(top).host.toLowerCase();
      const origin = `${new URL(top).protocol}//${host}`;
      withSite++;

      facts.push({
        npi: p.npi,
        fieldPath: "practice.website",
        value: { url: origin, hostname: host, queriedWith: query },
        valueText: origin,
        sourceUrl: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        confidence: 0.7,
      });
      channels.push({
        npi: p.npi,
        kind: "website",
        value: origin,
        verified: true,
        verifyMethod: "ddg_top_organic",
      });

      // Crawl a few likely contact paths.
      const paths = ["/", "/contact", "/contact-us", "/about", "/staff", "/providers", "/our-team"];
      const emailsFound = new Set<string>();
      for (const path of paths) {
        const html = await fetchPath(origin, path);
        if (!html) continue;
        for (const e of extractEmails(html, host)) emailsFound.add(e);
      }

      const onDomainEmails = Array.from(emailsFound).filter((e) => e.endsWith(`@${host}`) || e.endsWith(`@www.${host}`));
      const offDomainEmails = Array.from(emailsFound).filter((e) => !onDomainEmails.includes(e));

      if (onDomainEmails.length > 0) {
        withDirectEmail++;
        for (const email of onDomainEmails) {
          facts.push({
            npi: p.npi,
            fieldPath: "contact.email_practice",
            value: email,
            valueText: email,
            sourceUrl: origin,
            confidence: 0.75,
          });
          channels.push({
            npi: p.npi,
            kind: "email_practice",
            value: email,
            verified: true,
            verifyMethod: "scraped_domain_match",
          });
        }
      } else if (offDomainEmails.length > 0) {
        // Off-domain emails (e.g., generic Gmail) — write as low-confidence.
        for (const email of offDomainEmails.slice(0, 2)) {
          facts.push({
            npi: p.npi,
            fieldPath: "contact.email_offdomain",
            value: email,
            valueText: email,
            sourceUrl: origin,
            confidence: 0.45,
          });
        }
      } else {
        // No emails found — infer pattern candidates as Facts (low conf, not channels).
        const candidates = inferEmailFromPattern(host, p.firstName, p.lastName);
        if (candidates.length > 0) {
          withInferred++;
          factsEmail.push({
            npi: p.npi,
            fieldPath: "contact.email_inferred_candidates",
            value: candidates,
            sourceUrl: origin,
            confidence: 0.4,
          });
        }
      }
    } catch (err) {
      errors++;
      await sleep(SEARCH_DELAY_MS);
    }
  }

  console.log(`[${SOURCE_WEB}] Writing ${facts.length} facts / ${channels.length} channels`);
  const wRes = await writeFacts(prisma, SOURCE_WEB, facts, FRESHNESS_HOURS);
  const cCount = await writeChannels(prisma, channels);
  const eRes = await writeFacts(prisma, SOURCE_EMAIL, factsEmail, FRESHNESS_HOURS);

  console.log(`[${SOURCE_WEB}] Done. websites=${withSite} direct-emails=${withDirectEmail} inferred=${withInferred} errors=${errors}`);
  console.log(`  Facts written: web=${wRes.written} email=${eRes.written}; channels=${cCount}`);
  await markSourceRunSuccess(prisma, SOURCE_WEB);
  await markSourceRunSuccess(prisma, SOURCE_EMAIL);
}

if (require.main === module) {
  runEnricher()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

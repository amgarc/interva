// Per-physician web research + LLM extraction.
//
// For each NPI:
//   1. DuckDuckGo HTML search for `"<First Last>" "<City>" interventional radiology`
//   2. Filter aggregator hosts, take top 3 distinct domains
//   3. Fetch each (HTTP timeout 6s), strip HTML → plain text, truncate ~5K chars/page
//   4. Send pages + physician metadata to DeepSeek V4-flash with a strict
//      extraction schema. Use response_format=json_object for structured output.
//      DeepSeek's API auto-caches the system prompt prefix.
//   5. Parse JSON, write Facts (practice setting, practice name, URL,
//      subspecialties, bio, signals) + Channels (emails, phone) +
//      OutreachSignal (PRACTICE_RECLASSIFIED) per high-confidence change.
//
// Cost telemetry: tracks total prompt/completion/cache tokens per run and
// estimates total spend at completion.
//
// Usage:
//   LIMIT=10 npm run enrich:research                # 10-NPI smoke test
//   COHORT=all npm run enrich:research              # all 11,556

import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  writeFacts,
  writeChannels,
  writeSignals,
  markSourceRunStart,
  markSourceRunSuccess,
  sleep,
  pickCohort,
} from "./base";

const SOURCE_KEY = "LLM_RESEARCH";
const FRESHNESS_HOURS = 720;

// Brave Search free tier: 1 req/sec hard limit. 1100ms gives a small buffer.
const SEARCH_DELAY_MS = 1100;
const FETCH_TIMEOUT_MS = 6000;
const MAX_PAGES_PER_DOC = 3;
const MAX_CHARS_PER_PAGE = 5500;

// DeepSeek V4-flash pricing (approx, as of Apr 2026): input $0.07/Mtok,
// cache-hit $0.014/Mtok, output $0.28/Mtok.
const COST_INPUT_PER_MTOK = 0.07;
const COST_CACHE_HIT_PER_MTOK = 0.014;
const COST_OUTPUT_PER_MTOK = 0.28;

const prisma = new PrismaClient();

const AGGREGATOR_FRAGMENTS = [
  "healthgrades.com", "zocdoc.com", "vitals.com", "webmd.com", "wellness.com",
  "yelp.com", "ratemds.com", "caredash.com", "usnews.com", "youtube.com",
  "facebook.com", "linkedin.com", "twitter.com", "x.com", "instagram.com",
  "wikipedia.org", "google.com", "doctor.com", "yellowpages.com", "bbb.org",
  "medlineplus.gov", "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov", "amazon.com",
  "indeed.com", "glassdoor.com", "betterdoctor.com", "uschamber.com",
  "manta.com", "buzzfile.com", "physicians.us-business.info", "fda.gov",
  "cms.gov", "sharecare.com", "everyplace.com", "doximity.com",
];

const ExtractionSchema = z.object({
  practice_setting: z.enum([
    "HOSPITAL_EMPLOYED",
    "OBL_OWNER",
    "OBL_EMPLOYEE",
    "ASC_PARTNER",
    "ASC_EMPLOYEE",
    "ACADEMIC_FACULTY",
    "PRIVATE_PRACTICE_PARTNER",
    "PRIVATE_PRACTICE_EMPLOYEE",
    "RETIRED",
    "MULTIPLE_SETTINGS",
    "UNKNOWN",
  ]),
  practice_setting_confidence: z.number().min(0).max(1),
  primary_practice_name: z.string().nullable(),
  primary_practice_url: z.string().nullable(),
  emails: z.array(z.string()),
  direct_phone: z.string().nullable(),
  subspecialties: z.array(z.string()),
  bio_summary: z.string(),
  key_signals: z.array(z.string()),
  evidence_url: z.string().nullable(),
  confidence_overall: z.number().min(0).max(1),
});

type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM_PROMPT = `You are a medical-practice classifier for Interva Health, a company building an outreach funnel for US Interventional Radiology physicians. Given web pages about a US physician, extract structured information about THIS specific physician's practice and return it as JSON.

REQUIRED OUTPUT FIELDS (all must be present):
- practice_setting: one of HOSPITAL_EMPLOYED | OBL_OWNER | OBL_EMPLOYEE | ASC_PARTNER | ASC_EMPLOYEE | ACADEMIC_FACULTY | PRIVATE_PRACTICE_PARTNER | PRIVATE_PRACTICE_EMPLOYEE | RETIRED | MULTIPLE_SETTINGS | UNKNOWN
- practice_setting_confidence: 0.0-1.0 (how sure you are about practice_setting)
- primary_practice_name: the actual organization name where they primarily practice (e.g., "Vive Vascular", "OSU Wexner Medical Center"), or null
- primary_practice_url: the URL of that organization's website, or null
- emails: array of any direct work email addresses you found for this physician (lowercase). Empty array if none.
- direct_phone: their direct office phone if visible, or null
- subspecialties: array of clinical focus areas mentioned (e.g., "PAE", "uterine fibroid embolization", "Y90", "carotid stenting", "venous disease")
- bio_summary: 2-3 sentence summary of their training, focus, and current role
- key_signals: short tags useful for outreach. Examples: "owner-operator", "fellowship-trained-Michigan", "academic", "speaker-SIR-2025", "OBL-only", "ASC-partnership", "hospital-employed", "PE-owned"
- evidence_url: which URL you primarily relied on
- confidence_overall: 0.0-1.0 (how sure you are about everything overall)

CLASSIFICATION GUIDE:
- OBL_OWNER: physician owns / is partner in an Office-Based Lab (private practice doing IR procedures in an outpatient office setting). Strong signals: their name on the practice LLC, listed as "founder" or "partner", small practice with ≤10 docs, OBL-style services (PAE, UFE, vascular access, fistulograms).
- ASC_PARTNER: practices primarily at an Ambulatory Surgery Center, listed as a partner/owner of the ASC.
- HOSPITAL_EMPLOYED: their practice is a hospital department or hospital-employed group. Big-system page lists them with the hospital's branding.
- ACADEMIC_FACULTY: at a university medical center, listed as faculty (Assistant/Associate/Full Professor) at OSU/Stanford/Hopkins/etc.
- MULTIPLE_SETTINGS: clearly splits time between two distinct settings (e.g., "Practices at OSU AND owns Vive Vascular"). Use only when explicitly evidenced.
- UNKNOWN: pages don't contain enough info. Better to say UNKNOWN than guess.

RULES:
- Return ONLY valid JSON conforming to the schema. No prose, no markdown.
- Be conservative. Don't speculate beyond what's visible.
- If pages contradict each other, prefer their PRIMARY practice (the one most pages center on).
- A page on a private OBL/ASC website (e.g. vivevascular.com) is stronger evidence than a hospital directory listing the same name.
- For emails: only return emails that look like THIS physician's direct work email. Skip generic info@ / contact@ unless that's the only listed contact. Skip personal Gmail/Yahoo/etc.`;

function isAggregator(host: string): boolean {
  return AGGREGATOR_FRAGMENTS.some((f) => host.endsWith(f) || host.includes(f));
}

interface BraveSearchResponse {
  web?: { results?: { url: string; title?: string; description?: string }[] };
}

async function braveSearch(apiKey: string, query: string): Promise<string[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=US&safesearch=off`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) {
      // Rate limited — back off and retry once.
      await new Promise((r) => setTimeout(r, 2500));
      const retry = await fetch(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!retry.ok) return [];
      const data2 = (await retry.json()) as BraveSearchResponse;
      return (data2.web?.results ?? []).map((r) => r.url).filter((u) => u && u.startsWith("http"));
    }
    return [];
  }
  const data = (await res.json()) as BraveSearchResponse;
  return (data.web?.results ?? []).map((r) => r.url).filter((u) => u && u.startsWith("http"));
}

function pickTopUrls(urls: string[], n: number): string[] {
  const seenHosts = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    try {
      const host = new URL(u).host.toLowerCase();
      if (isAggregator(host)) continue;
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      out.push(u);
      if (out.length >= n) break;
    } catch {
      continue;
    }
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<string | null> {
  try {
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
    return stripHtml(text).slice(0, MAX_CHARS_PER_PAGE);
  } catch {
    return null;
  }
}

interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface DeepSeekResponse {
  choices: { message: { content: string } }[];
  usage: DeepSeekUsage;
}

async function callDeepSeek(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ extraction: Extraction | null; usage: DeepSeekUsage; rawText: string }> {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.0,
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = (await res.json()) as DeepSeekResponse;
  const rawText = data.choices?.[0]?.message?.content ?? "";
  let extraction: Extraction | null = null;
  try {
    const parsed = JSON.parse(rawText);
    extraction = ExtractionSchema.parse(parsed);
  } catch {
    extraction = null;
  }
  return { extraction, usage: data.usage, rawText };
}

interface CostTotals {
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
}

function dollars(t: CostTotals): number {
  // For non-cached input we approximate using promptTokens − cache hits.
  const cacheHit = t.cacheHitTokens;
  const fullCost = (t.promptTokens - cacheHit) * COST_INPUT_PER_MTOK / 1_000_000;
  const cacheCost = cacheHit * COST_CACHE_HIT_PER_MTOK / 1_000_000;
  const outputCost = t.completionTokens * COST_OUTPUT_PER_MTOK / 1_000_000;
  return fullCost + cacheCost + outputCost;
}

export async function runEnricher(npis?: string[]): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("DEEPSEEK_API_KEY not set in env");
    process.exit(1);
  }
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) {
    console.error("BRAVE_SEARCH_API_KEY not set in env");
    process.exit(1);
  }
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  await markSourceRunStart(prisma, SOURCE_KEY);

  let cohort = npis ?? (await pickCohort(prisma));
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0;
  if (limit > 0 && cohort.length > limit) {
    console.log(`[${SOURCE_KEY}] LIMIT=${limit}; trimming cohort from ${cohort.length}`);
    cohort = cohort.slice(0, limit);
  }
  console.log(`[${SOURCE_KEY}] Enriching ${cohort.length.toLocaleString()} NPIs with model=${model}`);

  const physicians = await prisma.physician.findMany({
    where: { npi: { in: cohort } },
    select: {
      npi: true,
      firstName: true,
      lastName: true,
      credentials: true,
      practiceSetting: true,
      addresses: { where: { kind: "practice" }, select: { line1: true, city: true, state: true, postalCode: true } },
    },
  });

  const facts: Parameters<typeof writeFacts>[2] = [];
  const channels: Parameters<typeof writeChannels>[1] = [];
  const signals: Parameters<typeof writeSignals>[1] = [];
  const totals: CostTotals = { promptTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, completionTokens: 0 };

  let i = 0;
  let extracted = 0;
  let noResults = 0;
  let llmFailed = 0;

  for (const p of physicians) {
    i++;
    if (i > 0 && i % 10 === 0) {
      console.log(
        `[${SOURCE_KEY}]   ${i}/${physicians.length}  ok=${extracted}  noResults=${noResults}  llmFail=${llmFailed}  cost=$${dollars(totals).toFixed(2)}`,
      );
    }
    if (!p.firstName || !p.lastName) continue;
    const addr = p.addresses[0];
    const city = addr?.city ?? "";
    if (!city) continue;

    const query = `"${p.firstName} ${p.lastName}" "${city}" interventional radiology`;
    let topUrls: string[] = [];
    try {
      const candidates = await braveSearch(braveKey, query);
      topUrls = pickTopUrls(candidates, MAX_PAGES_PER_DOC);
    } catch {
      // ignore search failure; still call LLM with no pages → likely UNKNOWN
    }
    await sleep(SEARCH_DELAY_MS);

    if (topUrls.length === 0) {
      noResults++;
      continue;
    }

    const pageBodies: { url: string; text: string }[] = [];
    for (const url of topUrls) {
      const text = await fetchPage(url);
      if (text && text.length > 200) pageBodies.push({ url, text });
    }
    if (pageBodies.length === 0) {
      noResults++;
      continue;
    }

    const userMessage = [
      `Physician: ${p.firstName} ${p.lastName}${p.credentials ? `, ${p.credentials}` : ""}`,
      `NPI: ${p.npi}`,
      `NPPES practice address: ${[addr?.line1, addr?.city, addr?.state, addr?.postalCode].filter(Boolean).join(", ")}`,
      `Medicare PUF setting: ${p.practiceSetting ?? "none"}`,
      ``,
      `--- Web pages (${pageBodies.length}) ---`,
      ...pageBodies.map((pg, idx) => `\n=== Page ${idx + 1}: ${pg.url} ===\n${pg.text}`),
      ``,
      `Return only the JSON object conforming to the schema described in the system prompt.`,
    ].join("\n");

    let extraction: Extraction | null = null;
    try {
      const result = await callDeepSeek(apiKey, model, SYSTEM_PROMPT, userMessage);
      extraction = result.extraction;
      totals.promptTokens += result.usage.prompt_tokens;
      totals.cacheHitTokens += result.usage.prompt_cache_hit_tokens ?? 0;
      totals.cacheMissTokens += result.usage.prompt_cache_miss_tokens ?? 0;
      totals.completionTokens += result.usage.completion_tokens;
    } catch (err) {
      llmFailed++;
      // brief backoff on failure (rate limits or transient)
      await sleep(800);
      continue;
    }

    if (!extraction) {
      llmFailed++;
      continue;
    }
    extracted++;

    const evUrl = extraction.evidence_url ?? pageBodies[0].url;

    facts.push({
      npi: p.npi,
      fieldPath: "practice.setting_classified",
      value: {
        setting: extraction.practice_setting,
        confidence: extraction.practice_setting_confidence,
      },
      valueText: extraction.practice_setting,
      sourceUrl: evUrl,
      confidence: extraction.practice_setting_confidence,
    });
    if (extraction.primary_practice_name) {
      facts.push({
        npi: p.npi,
        fieldPath: "practice.name",
        value: extraction.primary_practice_name,
        valueText: extraction.primary_practice_name,
        sourceUrl: evUrl,
        confidence: extraction.confidence_overall,
      });
    }
    if (extraction.primary_practice_url) {
      facts.push({
        npi: p.npi,
        fieldPath: "practice.url",
        value: extraction.primary_practice_url,
        valueText: extraction.primary_practice_url,
        sourceUrl: evUrl,
        confidence: extraction.confidence_overall,
      });
    }
    if (extraction.subspecialties.length > 0) {
      facts.push({
        npi: p.npi,
        fieldPath: "practice.subspecialties",
        value: extraction.subspecialties,
        valueText: extraction.subspecialties.join("; "),
        sourceUrl: evUrl,
        confidence: extraction.confidence_overall,
      });
    }
    if (extraction.bio_summary) {
      facts.push({
        npi: p.npi,
        fieldPath: "practice.bio_summary",
        value: extraction.bio_summary,
        valueText: extraction.bio_summary,
        sourceUrl: evUrl,
        confidence: extraction.confidence_overall,
      });
    }
    if (extraction.key_signals.length > 0) {
      facts.push({
        npi: p.npi,
        fieldPath: "outreach.key_signals",
        value: extraction.key_signals,
        valueText: extraction.key_signals.join("; "),
        sourceUrl: evUrl,
        confidence: extraction.confidence_overall,
      });
    }

    for (const email of extraction.emails) {
      const e = email.trim().toLowerCase();
      if (!e.includes("@")) continue;
      channels.push({
        npi: p.npi,
        kind: "email_practice",
        value: e,
        verified: extraction.confidence_overall >= 0.7,
        verifyMethod: "deepseek_research",
      });
    }
    if (extraction.direct_phone) {
      channels.push({
        npi: p.npi,
        kind: "phone_direct",
        value: extraction.direct_phone,
        verified: extraction.confidence_overall >= 0.7,
        verifyMethod: "deepseek_research",
      });
    }

    // Reclassification signal if LLM disagrees with PUF setting
    if (
      extraction.practice_setting_confidence >= 0.7 &&
      ["OBL_OWNER", "OBL_EMPLOYEE", "ASC_PARTNER", "ASC_EMPLOYEE", "MULTIPLE_SETTINGS"].includes(extraction.practice_setting) &&
      p.practiceSetting !== "OBL"
    ) {
      signals.push({
        npi: p.npi,
        kind: "OBL_ASC_RECLASSIFIED",
        occurredAt: new Date(),
        summary: `Reclassified as ${extraction.practice_setting} via web research (PUF said ${p.practiceSetting ?? "no PUF"})`,
        payload: {
          practice_name: extraction.primary_practice_name,
          confidence: extraction.practice_setting_confidence,
        },
      });
    }
  }

  console.log(`\n[${SOURCE_KEY}] Writing ${facts.length} facts / ${channels.length} channels / ${signals.length} signals`);
  const factResult = await writeFacts(prisma, SOURCE_KEY, facts, FRESHNESS_HOURS);
  const chCount = await writeChannels(prisma, channels);
  const sigCount = await writeSignals(prisma, signals);

  const totalCost = dollars(totals);
  console.log(`\n[${SOURCE_KEY}] Done.`);
  console.log(`  Physicians processed:   ${i}`);
  console.log(`  Successful extractions: ${extracted}`);
  console.log(`  No web results:         ${noResults}`);
  console.log(`  LLM failures:           ${llmFailed}`);
  console.log(`  Facts written:          ${factResult.written}`);
  console.log(`  Channels written:       ${chCount}`);
  console.log(`  Signals written:        ${sigCount}`);
  console.log(`\n  Tokens: prompt=${totals.promptTokens.toLocaleString()} (cache-hit=${totals.cacheHitTokens.toLocaleString()}) output=${totals.completionTokens.toLocaleString()}`);
  console.log(`  Estimated DeepSeek cost: $${totalCost.toFixed(3)}`);
  if (extracted > 0) {
    console.log(`  Per successful extraction: $${(totalCost / extracted).toFixed(4)}`);
    console.log(`  Projected for 11,556 docs: $${((totalCost / extracted) * 11556).toFixed(2)}`);
  }

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

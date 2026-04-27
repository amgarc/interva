// NPI Registry public detail API — fills gaps the bulk NPPES file misses:
// secondary practice locations, endpoint URLs (some EHR/telehealth endpoints
// expose direct contacts), other names, more taxonomy detail.
//
// Source: https://npiregistry.cms.hhs.gov/api/?number=<NPI>&version=2.1
// JSON response, no auth, generous rate limits (CMS asks ~10/s polite max).

import { PrismaClient } from "@prisma/client";
import {
  writeFacts,
  writeSignals,
  writeChannels,
  markSourceRunStart,
  markSourceRunSuccess,
  sleep,
  getOblAscActiveCohort,
} from "./base";

const SOURCE_KEY = "NPI_REGISTRY_DETAIL";
const FRESHNESS_HOURS = 720;
const RATE_LIMIT_MS = 110; // ~9 req/sec

const prisma = new PrismaClient();

interface NpiRegistryResponse {
  result_count: number;
  results: Array<{
    number: string;
    enumeration_type: string;
    addresses?: Array<{
      address_purpose: "MAILING" | "LOCATION" | "PRIMARY" | "SECONDARY";
      address_1?: string;
      address_2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      telephone_number?: string;
      fax_number?: string;
    }>;
    practiceLocations?: Array<{
      address_1?: string;
      address_2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      telephone_number?: string;
      fax_number?: string;
    }>;
    endpoints?: Array<{
      endpoint?: string;
      endpointType?: string;
      endpointDescription?: string;
    }>;
    other_names?: Array<{
      organization_name?: string;
      first_name?: string;
      last_name?: string;
      type?: string;
    }>;
  }>;
}

export async function runEnricher(npis?: string[]): Promise<void> {
  await markSourceRunStart(prisma, SOURCE_KEY);
  const cohort = npis ?? (await getOblAscActiveCohort(prisma));
  console.log(`[${SOURCE_KEY}] Enriching ${cohort.length.toLocaleString()} NPIs`);

  const facts: Parameters<typeof writeFacts>[2] = [];
  const signals: Parameters<typeof writeSignals>[1] = [];
  const channels: Parameters<typeof writeChannels>[1] = [];
  let success = 0;
  let errors = 0;

  for (let i = 0; i < cohort.length; i++) {
    const npi = cohort[i];
    if (i > 0 && i % 100 === 0) {
      console.log(`[${SOURCE_KEY}]   ${i}/${cohort.length}  ok=${success}  err=${errors}`);
    }
    try {
      const url = `https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`;
      const res = await fetch(url);
      if (!res.ok) {
        errors++;
        await sleep(RATE_LIMIT_MS);
        continue;
      }
      const data = (await res.json()) as NpiRegistryResponse;
      if (data.result_count === 0 || !data.results?.[0]) {
        await sleep(RATE_LIMIT_MS);
        continue;
      }
      const r = data.results[0];

      // Practice locations beyond the primary one we already loaded.
      if (r.practiceLocations && r.practiceLocations.length > 0) {
        facts.push({
          npi,
          fieldPath: "practice.secondary_locations",
          value: r.practiceLocations,
          sourceUrl: url,
          confidence: 0.92,
        });
      }

      // Endpoints — sometimes contains direct EHR contact / telehealth links / personal websites.
      if (r.endpoints && r.endpoints.length > 0) {
        facts.push({
          npi,
          fieldPath: "practice.endpoints",
          value: r.endpoints,
          sourceUrl: url,
          confidence: 0.92,
        });
        // Mine endpoints for emails or websites.
        for (const ep of r.endpoints) {
          const epStr = ep.endpoint ?? "";
          if (epStr.match(/^https?:\/\//i)) {
            channels.push({
              npi,
              kind: "website",
              value: epStr,
              verified: false,
              verifyMethod: "npi_registry_endpoint",
            });
          }
          // Direct messaging / email-style endpoints (X12 DIRECT).
          if (epStr.includes("@") && ep.endpointType?.toLowerCase().includes("direct")) {
            channels.push({
              npi,
              kind: "email_direct",
              value: epStr,
              verified: false,
              verifyMethod: "npi_registry_direct_endpoint",
            });
          }
        }
      }

      // Phone fallback if NPPES bulk had no phone but registry detail does.
      const primary = r.addresses?.find((a) => a.address_purpose === "LOCATION" || a.address_purpose === "PRIMARY");
      if (primary?.telephone_number) {
        channels.push({
          npi,
          kind: "phone_practice",
          value: primary.telephone_number,
          verified: false,
          verifyMethod: "npi_registry",
        });
      }

      success++;
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      errors++;
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log(`[${SOURCE_KEY}] Writing ${facts.length} facts / ${channels.length} channels / ${signals.length} signals`);
  const { written } = await writeFacts(prisma, SOURCE_KEY, facts, FRESHNESS_HOURS);
  const channelCount = await writeChannels(prisma, channels);
  const signalCount = await writeSignals(prisma, signals);

  console.log(`[${SOURCE_KEY}] Done. facts=${written} channels=${channelCount} signals=${signalCount} errors=${errors}`);
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

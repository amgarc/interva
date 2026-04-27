// ClinicalTrials.gov enricher: identifies physicians who are listed as
// investigators on active or recent IR-related trials. Strong signal for
// "commercially engaged with industry" — sponsors are the device makers.
//
// Source: https://clinicaltrials.gov/api/v2/studies (free, no auth)

import { PrismaClient } from "@prisma/client";
import {
  writeFacts,
  writeSignals,
  markSourceRunStart,
  markSourceRunSuccess,
  sleep,
  getOblAscActiveCohort,
} from "./base";

const SOURCE_KEY = "CLINICALTRIALS_GOV";
const FRESHNESS_HOURS = 720;
const RATE_LIMIT_MS = 250;

const prisma = new PrismaClient();

interface CtgStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: { overallStatus?: string; lastUpdateSubmitDate?: string };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    contactsLocationsModule?: {
      overallOfficials?: Array<{ name?: string; role?: string; affiliation?: string }>;
      locations?: Array<{
        facility?: string;
        city?: string;
        state?: string;
        contacts?: Array<{ name?: string; role?: string; phone?: string; email?: string }>;
      }>;
    };
    designModule?: { studyType?: string };
    conditionsModule?: { conditions?: string[] };
  };
}

interface CtgResponse {
  studies: CtgStudy[];
  nextPageToken?: string;
}

async function searchTrialsByName(lastName: string, firstName: string): Promise<CtgStudy[]> {
  // Search by investigator name. ClinicalTrials.gov API v2 uses query.term plus filters.
  const term = encodeURIComponent(`${firstName} ${lastName}`);
  const url =
    `https://clinicaltrials.gov/api/v2/studies?` +
    `query.term=${term}&` +
    `query.intr=interventional+radiology+OR+embolization+OR+ablation+OR+angioplasty&` +
    `pageSize=20&` +
    `format=json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as CtgResponse;
  return data.studies ?? [];
}

function physicianAppearsInTrial(
  trial: CtgStudy,
  lastName: string,
  firstName: string,
): { evidence: string; affiliation?: string } | null {
  const lastUp = lastName.toUpperCase();
  const firstUp = firstName.toUpperCase();
  // Check overallOfficials
  for (const o of trial.protocolSection?.contactsLocationsModule?.overallOfficials ?? []) {
    const n = (o.name ?? "").toUpperCase();
    if (n.includes(lastUp) && (n.includes(firstUp) || n.includes(firstUp.charAt(0) + "."))) {
      return { evidence: `Investigator: ${o.name} (${o.role ?? "?"})`, affiliation: o.affiliation };
    }
  }
  // Check site-level contacts
  for (const loc of trial.protocolSection?.contactsLocationsModule?.locations ?? []) {
    for (const c of loc.contacts ?? []) {
      const n = (c.name ?? "").toUpperCase();
      if (n.includes(lastUp) && (n.includes(firstUp) || n.includes(firstUp.charAt(0) + "."))) {
        return {
          evidence: `Site contact: ${c.name} at ${loc.facility ?? loc.city ?? "site"}`,
          affiliation: loc.facility,
        };
      }
    }
  }
  return null;
}

export async function runEnricher(npis?: string[]): Promise<void> {
  await markSourceRunStart(prisma, SOURCE_KEY);
  const cohort = npis ?? (await getOblAscActiveCohort(prisma));
  console.log(`[${SOURCE_KEY}] Enriching ${cohort.length.toLocaleString()} NPIs`);

  const physicians = await prisma.physician.findMany({
    where: { npi: { in: cohort } },
    select: { npi: true, firstName: true, lastName: true },
  });

  const facts: Parameters<typeof writeFacts>[2] = [];
  const signals: Parameters<typeof writeSignals>[1] = [];
  let withTrials = 0;
  let errors = 0;
  let i = 0;

  for (const p of physicians) {
    i++;
    if (i % 50 === 0) console.log(`[${SOURCE_KEY}]   ${i}/${physicians.length}  withTrials=${withTrials}  err=${errors}`);
    if (!p.lastName || !p.firstName) continue;
    try {
      const trials = await searchTrialsByName(p.lastName, p.firstName);
      const matched: Array<{
        nctId: string;
        title: string;
        status: string;
        sponsor: string;
        evidence: string;
      }> = [];
      for (const t of trials) {
        const m = physicianAppearsInTrial(t, p.lastName, p.firstName);
        if (!m) continue;
        matched.push({
          nctId: t.protocolSection?.identificationModule?.nctId ?? "?",
          title: t.protocolSection?.identificationModule?.briefTitle ?? "",
          status: t.protocolSection?.statusModule?.overallStatus ?? "",
          sponsor: t.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name ?? "",
          evidence: m.evidence,
        });
      }
      if (matched.length === 0) {
        await sleep(RATE_LIMIT_MS);
        continue;
      }
      withTrials++;
      facts.push({
        npi: p.npi,
        fieldPath: "industry.active_trials",
        value: matched,
        sourceUrl: `https://clinicaltrials.gov/search?term=${encodeURIComponent(p.lastName)}+${encodeURIComponent(p.firstName)}`,
        confidence: 0.7,
      });
      facts.push({
        npi: p.npi,
        fieldPath: "industry.active_trial_count",
        value: matched.length,
        sourceUrl: `https://clinicaltrials.gov/search?term=${encodeURIComponent(p.lastName)}+${encodeURIComponent(p.firstName)}`,
        confidence: 0.7,
      });
      // Signal: at least one active trial = commercially engaged.
      const recent = matched[0];
      signals.push({
        npi: p.npi,
        kind: "ACTIVE_TRIAL_INVESTIGATOR",
        occurredAt: new Date(),
        summary: `Investigator on ${matched.length} clinical trial${matched.length > 1 ? "s" : ""}; sponsor "${recent.sponsor}"`,
      });
      await sleep(RATE_LIMIT_MS);
    } catch {
      errors++;
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log(`[${SOURCE_KEY}] Writing ${facts.length} facts / ${signals.length} signals`);
  const { written } = await writeFacts(prisma, SOURCE_KEY, facts, FRESHNESS_HOURS);
  const sigCount = await writeSignals(prisma, signals);
  console.log(`[${SOURCE_KEY}] Done. facts=${written} signals=${sigCount} withTrials=${withTrials} errors=${errors}`);
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

// Persona derivation: from raw Facts + Signals + NPPES/PUF/affiliation fields,
// compute Interva-tailored archetype + hook summary per active OBL/ASC IR.
//
// Archetypes:
//   OBL_PARTNER_OWNER    — practiceSetting=OBL, no hospital affiliation, multi-CPT volume → independent owner-operator
//   OBL_PRACTITIONER     — OBL setting but limited CPT breadth → light OBL, may be employee
//   ASC_PARTNER          — ASC-affiliated, no hospital affiliation, FACILITY setting → likely partner ASC
//   ASC_HYBRID           — ASC-affiliated AND hospital-affiliated → splits time, partial owner
//   HOSPITAL_EMPLOYED    — hospital-affiliated, FACILITY setting, no ASC link
//   ACADEMIC_FACULTY     — hospital-affiliated AND has PubMed publications in last 5y
//   PE_OWNED_PRACTICE    — flagged as PE-owned (future signal)
//   DISQUALIFIED         — OIG-excluded, deactivated, or deceased
//   UNKNOWN              — insufficient data
//
// Hook summary is a 1-3 sentence Interva-flavored opener built from:
//   - subspecialty mix (vascular-heavy / embolization / dialysis)
//   - recent paper signal
//   - active trial signal
//   - geographic detail
//   - independence signal (no hospital affiliation)

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

interface PhysicianContext {
  npi: string;
  firstName: string | null;
  lastName: string | null;
  practiceSetting: string | null;
  hasAscAffiliation: boolean;
  hasHospitalAffiliation: boolean;
  isActiveIr: boolean;
  totalIrServices: number | null;
  distinctIrCpts: number | null;
  activeIrCategories: string[];
  deactivationDate: Date | null;
  practiceCity: string | null;
  practiceState: string | null;
  cbsaName: string | null;
  factsByPath: Map<string, Prisma.JsonValue>;
  signalKinds: Set<string>;
  recentPaperSummary: string | null;
  trialSponsor: string | null;
}

async function loadContexts(): Promise<PhysicianContext[]> {
  // Only OBL/ASC active cohort + anyone OIG-excluded (so we mark them DISQUALIFIED).
  const physicians = await prisma.physician.findMany({
    where: {
      OR: [
        { isActiveIr: true, OR: [{ practiceSetting: "OBL" }, { hasAscAffiliation: true }] },
        { facts: { some: { fieldPath: "compliance.oig_excluded", supersededById: null } } },
      ],
    },
    include: {
      addresses: { where: { kind: "practice" }, take: 1 },
      facts: { where: { supersededById: null } },
      signals: { orderBy: { occurredAt: "desc" }, take: 10 },
    },
  });

  return physicians.map<PhysicianContext>((p) => {
    const factsByPath = new Map<string, Prisma.JsonValue>();
    for (const f of p.facts) factsByPath.set(f.fieldPath, f.value as Prisma.JsonValue);
    const signalKinds = new Set(p.signals.map((s) => s.kind));
    const paperSig = p.signals.find((s) => s.kind === "PUBLISHED_PAPER");
    const trialSig = p.signals.find((s) => s.kind === "ACTIVE_TRIAL_INVESTIGATOR");
    return {
      npi: p.npi,
      firstName: p.firstName,
      lastName: p.lastName,
      practiceSetting: p.practiceSetting,
      hasAscAffiliation: p.hasAscAffiliation,
      hasHospitalAffiliation: p.hasHospitalAffiliation,
      isActiveIr: p.isActiveIr,
      totalIrServices: p.totalIrServices,
      distinctIrCpts: p.distinctIrCpts,
      activeIrCategories: p.activeIrCategories,
      deactivationDate: p.deactivationDate,
      practiceCity: p.addresses[0]?.city ?? null,
      practiceState: p.addresses[0]?.state ?? null,
      cbsaName: p.addresses[0]?.cbsaName ?? null,
      factsByPath,
      signalKinds,
      recentPaperSummary: paperSig?.summary ?? null,
      trialSponsor: trialSig?.summary ?? null,
    };
  });
}

function deriveArchetype(c: PhysicianContext): { archetype: string; confidence: number; disqualifiers: string[] } {
  const dq: string[] = [];
  if (c.deactivationDate) dq.push("DEACTIVATED");
  if (c.factsByPath.has("compliance.oig_excluded")) dq.push("OIG_EXCLUDED");
  if (dq.length > 0) return { archetype: "DISQUALIFIED", confidence: 0.99, disqualifiers: dq };

  // Strong-signal archetypes first.
  if (c.practiceSetting === "OBL" && !c.hasHospitalAffiliation) {
    return { archetype: "OBL_PARTNER_OWNER", confidence: 0.85, disqualifiers: [] };
  }
  if (c.practiceSetting === "OBL" && c.hasHospitalAffiliation) {
    return { archetype: "OBL_PRACTITIONER", confidence: 0.7, disqualifiers: [] };
  }
  if (c.hasAscAffiliation && !c.hasHospitalAffiliation && c.practiceSetting === "FACILITY") {
    return { archetype: "ASC_PARTNER", confidence: 0.75, disqualifiers: [] };
  }
  if (c.hasAscAffiliation && c.hasHospitalAffiliation) {
    return { archetype: "ASC_HYBRID", confidence: 0.6, disqualifiers: [] };
  }
  // Academic if publishing AND hospital-affiliated.
  const pubCount = c.factsByPath.get("academic.publication_count_5y") as number | undefined;
  if (c.hasHospitalAffiliation && pubCount && pubCount >= 3) {
    return { archetype: "ASC_PARTNER", confidence: 0.55, disqualifiers: [] }; // ASC-tagged but academic
  }
  if (c.hasHospitalAffiliation) {
    return { archetype: "HOSPITAL_EMPLOYED", confidence: 0.65, disqualifiers: [] };
  }
  return { archetype: "UNKNOWN", confidence: 0.3, disqualifiers: [] };
}

function categoryHook(cats: string[]): string {
  if (cats.includes("EMBOLIZATION")) return "embolization-heavy";
  if (cats.includes("DIALYSIS_ACCESS")) return "dialysis access-focused";
  if (cats.includes("VASCULAR")) return "vascular-focused";
  if (cats.includes("TUMOR_ABLATION")) return "tumor-ablation-focused";
  if (cats.includes("VENOUS_ACCESS")) return "venous-access-focused";
  return "broad IR practice";
}

function deriveHookSummary(c: PhysicianContext, archetype: string): string {
  const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "This physician";
  const where = c.cbsaName ?? `${c.practiceCity ?? "?"}, ${c.practiceState ?? "?"}`;
  const hook = categoryHook(c.activeIrCategories);
  const volume = c.totalIrServices != null ? `${c.totalIrServices.toLocaleString()} Medicare IR services` : "active Medicare IR billing";
  const breadth = c.distinctIrCpts != null && c.distinctIrCpts >= 5 ? ` across ${c.distinctIrCpts} distinct CPTs` : "";

  let intro = "";
  switch (archetype) {
    case "OBL_PARTNER_OWNER":
      intro = `${name} is an independent OBL operator in ${where} (${hook}, ${volume}${breadth}). No hospital affiliation in CMS data — owner-operator persona, capital-equipment buyer.`;
      break;
    case "OBL_PRACTITIONER":
      intro = `${name} practices in an OBL setting in ${where} (${hook}, ${volume}${breadth}) with hospital affiliations on the side — likely a junior partner or per-diem.`;
      break;
    case "ASC_PARTNER":
      intro = `${name} works primarily out of an ASC in ${where} (${hook}, ${volume}${breadth}). No hospital affiliation in CMS data — likely partner-owned ASC, commercial-buyer persona.`;
      break;
    case "ASC_HYBRID":
      intro = `${name} splits time between an ASC and a hospital in ${where} (${hook}, ${volume}${breadth}) — likely a partial-owner.`;
      break;
    case "HOSPITAL_EMPLOYED":
      intro = `${name} is hospital-employed in ${where} (${hook}, ${volume}${breadth}). Outreach should target hospital supply chain in parallel.`;
      break;
    case "DISQUALIFIED":
      intro = `${name} is disqualified from outreach (${c.factsByPath.has("compliance.oig_excluded") ? "OIG-excluded" : "deactivated"}). Skip.`;
      break;
    default:
      intro = `${name} in ${where}. ${hook}, ${volume}${breadth}. Persona unclear — collect more enrichment.`;
  }

  // Append timeliness signals.
  const tail: string[] = [];
  if (c.recentPaperSummary) tail.push(`Recent: ${c.recentPaperSummary}`);
  if (c.trialSponsor) tail.push(`${c.trialSponsor}`);
  if (tail.length > 0) intro += "  " + tail.join("  ");
  return intro;
}

export async function runDerivation(): Promise<void> {
  console.log("[derive-persona] Loading physician contexts…");
  const contexts = await loadContexts();
  console.log(`[derive-persona] ${contexts.length.toLocaleString()} physicians in scope`);

  let written = 0;
  const archetypeCounts = new Map<string, number>();
  for (const c of contexts) {
    const { archetype, confidence, disqualifiers } = deriveArchetype(c);
    const hookSummary = deriveHookSummary(c, archetype);
    archetypeCounts.set(archetype, (archetypeCounts.get(archetype) ?? 0) + 1);

    await prisma.outreachPersona.upsert({
      where: { npi: c.npi },
      create: {
        npi: c.npi,
        archetype,
        archetypeConfidence: confidence,
        hookSummary,
        qualifyingFactIds: [],
        disqualifiers,
      },
      update: {
        archetype,
        archetypeConfidence: confidence,
        hookSummary,
        disqualifiers,
        computedAt: new Date(),
      },
    });
    written++;
  }

  console.log(`\n[derive-persona] Wrote ${written.toLocaleString()} personas`);
  console.log("\n=== Archetype distribution ===");
  for (const [k, v] of [...archetypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${v.toLocaleString()}`);
  }
}

if (require.main === module) {
  runDerivation()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

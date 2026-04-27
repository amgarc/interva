// Canonical registry of every enrichment source. Loaded into the Source
// table via scripts/seed-sources.ts. Add new sources here when you build
// a new enricher.

export interface SourceSpec {
  key: string;
  displayName: string;
  category: "verified" | "inferred" | "scraped" | "user_entered" | "derived";
  baseConfidence: number;     // 0..1
  freshnessHours: number;     // re-run if older than this
  notes?: string;
}

export const SOURCES: SourceSpec[] = [
  // Already-ingested sources (Milestones 1-3)
  { key: "NPPES",                    displayName: "NPPES (NPI Registry bulk file)",         category: "verified", baseConfidence: 0.95, freshnessHours: 720, notes: "Authoritative for NPI, name, taxonomy, primary practice address." },
  { key: "MEDICARE_PUF",             displayName: "Medicare Physician & Other Practitioners (PUF)", category: "verified", baseConfidence: 0.95, freshnessHours: 8760 },
  { key: "CMS_FACILITIES",           displayName: "CMS Hospital General Information + ASC Quality Measures", category: "verified", baseConfidence: 0.95, freshnessHours: 720 },
  { key: "CMS_FACILITY_AFFILIATION", displayName: "CMS Doctors and Clinicians — Facility Affiliation", category: "verified", baseConfidence: 0.9, freshnessHours: 720 },
  { key: "INFERRED_ZIP_CITY",        displayName: "Inferred from address ZIP+city match",   category: "inferred", baseConfidence: 0.55, freshnessHours: 720 },
  { key: "CENSUS_ZCTA_CBSA",         displayName: "Census ZCTA→County + OMB CBSA delineation", category: "verified", baseConfidence: 0.95, freshnessHours: 8760 },

  // Sprint 1-2 enrichers
  { key: "NPI_REGISTRY_DETAIL",      displayName: "NPI Registry public detail page (npiregistry.cms.hhs.gov)", category: "verified", baseConfidence: 0.92, freshnessHours: 720 },
  { key: "PUBMED_EUTILS",            displayName: "PubMed E-utilities (NLM)",                category: "verified", baseConfidence: 0.85, freshnessHours: 720, notes: "Returns publications by author-name match; verify with affiliation/specialty cross-check." },
  { key: "OIG_EXCLUSION_LIST",       displayName: "HHS-OIG List of Excluded Individuals/Entities (LEIE)", category: "verified", baseConfidence: 0.99, freshnessHours: 720 },
  { key: "CLINICALTRIALS_GOV",       displayName: "ClinicalTrials.gov public API",            category: "verified", baseConfidence: 0.85, freshnessHours: 720 },
  { key: "PRACTICE_WEBSITE_SCRAPE",  displayName: "Practice website (auto-discovered + scraped)", category: "scraped", baseConfidence: 0.7, freshnessHours: 720 },
  { key: "EMAIL_PATTERN_INFERENCE",  displayName: "Email inferred from practice domain pattern + SMTP probe", category: "inferred", baseConfidence: 0.55, freshnessHours: 720 },
  { key: "CONFERENCE_SPEAKER_PDF",   displayName: "Conference faculty/speaker PDFs (SIR/RSNA/VIVA/GEST)", category: "scraped", baseConfidence: 0.85, freshnessHours: 8760 },

  // Skip-with-scaffold (need credentials or per-state work)
  { key: "GOOGLE_PLACES",            displayName: "Google Maps Places API",                   category: "verified", baseConfidence: 0.85, freshnessHours: 720, notes: "Requires GOOGLE_PLACES_API_KEY in env. Free tier: 5K req/mo." },
  { key: "VENDOR_CASE_STUDY",        displayName: "Device-vendor physician case studies (BSC, Cook, Penumbra, Medtronic, Sirtex)", category: "scraped", baseConfidence: 0.85, freshnessHours: 8760 },
  { key: "STATE_BUSINESS_FILING",    displayName: "State Secretary of State LLC/PC filings",  category: "scraped", baseConfidence: 0.8, freshnessHours: 8760 },

  // Computed-from-other-facts derivations
  { key: "DERIVED_PERSONA",          displayName: "Interva persona derivation (computed)",    category: "derived", baseConfidence: 0.8, freshnessHours: 168 },
];

export const SOURCE_BY_KEY: Record<string, SourceSpec> = Object.fromEntries(
  SOURCES.map((s) => [s.key, s]),
);

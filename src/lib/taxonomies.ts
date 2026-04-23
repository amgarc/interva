// NUCC Healthcare Provider Taxonomy codes relevant to Interventional Radiology.
// Verified against NUCC 2026-04. Update here if NUCC adds a dedicated Peds IR
// or Neurointerventional code (publishes Jan 1 / Jul 1).

export const IR_TAXONOMIES = {
  "2085R0204X": "Radiology / Vascular & Interventional Radiology",
  "2085N0700X": "Radiology / Neuroradiology",
  "2085P0229X": "Radiology / Pediatric Radiology",
} as const;

export type IrTaxonomyCode = keyof typeof IR_TAXONOMIES;

export const IR_TAXONOMY_CODES = Object.keys(IR_TAXONOMIES) as IrTaxonomyCode[];

// Secondary/adjacent code — NOT included by default (high false-positive rate for
// an IR-only funnel), but surfaced so you can toggle it on if needed.
export const ADJACENT_TAXONOMIES = {
  "2085R0202X": "Radiology / Diagnostic Radiology",
} as const;

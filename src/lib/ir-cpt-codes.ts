// HCPCS/CPT codes that define "active Interventional Radiology" for the purpose
// of filtering Medicare PUF. Sourced from SIR coding resources, ACR bulletins,
// and AMA CPT 2024, verified 2026-04.
//
// TIER 1 codes are IR-defining. A physician billing ≥N services across these
// codes in a PUF year = "active IR" for our funnel.
//
// TIER 2 codes (guidance/support) are bundled *in addition to* Tier 1, so they
// tell us which tier-1 procedures were image-guided. Not used for active-flag
// derivation on their own (too many non-IR specialties also bill them).

export const IR_CPT_TIER_1 = {
  VASCULAR: {
    // Iliac
    "37220": "Iliac revascularization, angioplasty only, unilateral",
    "37221": "Iliac revascularization with stent, unilateral",
    "37222": "Iliac revascularization, angioplasty, each additional vessel",
    "37223": "Iliac revascularization with stent, each additional vessel",
    // Femoral-popliteal
    "37224": "Fem-pop angioplasty only",
    "37225": "Fem-pop with atherectomy",
    "37226": "Fem-pop with stent",
    "37227": "Fem-pop with stent + atherectomy",
    // Tibial-peroneal
    "37228": "Tib-per angioplasty only",
    "37229": "Tib-per with atherectomy",
    "37230": "Tib-per with stent",
    "37231": "Tib-per with stent + atherectomy",
    "37232": "Tib-per angioplasty, additional vessel",
    "37233": "Tib-per atherectomy, additional vessel",
    "37234": "Tib-per stent, additional vessel",
    "37235": "Tib-per stent + atherectomy, additional vessel",
    // Carotid / vertebral / extracranial
    "37215": "Carotid stent with distal protection",
    "37216": "Carotid stent without distal protection",
    "37217": "Intrathoracic carotid/innominate stent, retrograde",
    "37218": "Intrathoracic carotid/innominate stent, antegrade",
    // Visceral (renal, mesenteric, other non-coronary)
    "37236": "Non-selective artery stent, initial",
    "37237": "Non-selective artery stent, additional",
    "37238": "Selective vein stent, initial",
    "37239": "Selective vein stent, additional",
    "37246": "Transluminal angioplasty, artery, initial",
    "37247": "Transluminal angioplasty, artery, additional",
    "37248": "Transluminal angioplasty, vein, initial",
    "37249": "Transluminal angioplasty, vein, additional",
  },
  EMBOLIZATION: {
    "37241": "Embolization, venous (non-hemorrhage, non-tumor)",
    "37242": "Embolization, arterial (UFE, PAE, BAE)",
    "37243": "Embolization for tumor (TACE, bland, DEB-TACE)",
    "37244": "Embolization for hemorrhage/trauma/lymphatic leak",
    "79445": "Intra-arterial radioactive particle administration (Y90)",
    "61624": "Transcatheter CNS embolization",
    "61626": "Transcatheter non-CNS head/neck embolization",
  },
  VENOUS_ACCESS: {
    "36555": "Non-tunneled CVC, <5yo",
    "36556": "Non-tunneled CVC, ≥5yo",
    "36557": "Tunneled CVC w/o port, <5yo",
    "36558": "Tunneled CVC w/o port, ≥5yo",
    "36560": "Tunneled CVC w/ port, <5yo",
    "36561": "Tunneled CVC w/ port, ≥5yo",
    "36563": "Tunneled CVC w/ pump",
    "36565": "Tunneled CVC, two catheters",
    "36568": "PICC w/o imaging, <5yo",
    "36569": "PICC w/o imaging, ≥5yo",
    "36572": "PICC w/ imaging, <5yo",
    "36573": "PICC w/ imaging, ≥5yo",
    "36578": "Replace tunneled catheter portion of port",
    "36580": "Replace non-tunneled CVC",
    "36581": "Replace tunneled CVC w/o port",
    "36582": "Replace tunneled CVC w/ port",
    "36584": "Replace PICC w/ imaging",
    "36585": "Replace tunneled port catheter",
    "37191": "IVC filter placement",
    "37192": "IVC filter repositioning",
    "37193": "IVC filter removal",
    "37211": "Transcatheter thrombolysis, arterial, initial day",
    "37212": "Transcatheter thrombolysis, venous, initial day",
    "37213": "Thrombolysis, continued, subsequent day",
    "37214": "Thrombolysis, cessation",
    "37187": "Percutaneous venous mechanical thrombectomy",
    "37188": "Percutaneous venous mechanical thrombectomy, repeat",
  },
  BIOPSY_DRAINAGE: {
    "10005": "FNA w/ US guidance, first lesion",
    "10006": "FNA w/ US guidance, each additional",
    "10009": "FNA w/ CT guidance, first lesion",
    "10010": "FNA w/ CT guidance, each additional",
    "10011": "FNA w/ MR guidance, first lesion",
    "10012": "FNA w/ MR guidance, each additional",
    "47000": "Percutaneous liver biopsy",
    "47001": "Liver biopsy, add-on",
    "49180": "Percutaneous abdominal/retroperitoneal biopsy",
    "50200": "Percutaneous renal biopsy",
    "32405": "Percutaneous lung/mediastinum biopsy",
    "49405": "Image-guided fluid collection drainage, visceral",
    "49406": "Image-guided drainage, peritoneal/retroperitoneal",
    "49407": "Image-guided drainage, transvaginal/transrectal",
    "47490": "Percutaneous cholecystostomy",
    "47531": "Biliary catheter, new access, diagnostic",
    "47532": "Biliary catheter, new access",
    "47533": "External biliary drainage",
    "47534": "Internal-external biliary drainage",
    "47535": "Conversion external to internal",
    "47536": "Exchange biliary catheter",
    "47537": "Removal biliary catheter",
    "47538": "Biliary stent via existing access",
    "47539": "Biliary stent, new access, no drain",
    "47540": "Biliary stent, new access, w/ drain",
    "47541": "Biliary access for endoscopy",
    "47542": "Biliary balloon dilation",
    "47543": "Biliary endoluminal biopsy",
    "50432": "Nephrostomy placement",
    "50433": "Nephroureteral catheter placement",
    "50434": "Conversion nephrostomy to nephroureteral",
    "50435": "Nephrostomy exchange",
    "50436": "Dilation existing ureteral tract",
    "50437": "Dilation w/ new access",
  },
  DIALYSIS_ACCESS: {
    "36901": "Dialysis circuit diagnostic angiography",
    "36902": "Dialysis circuit w/ angioplasty, peripheral",
    "36903": "Dialysis circuit w/ stent, peripheral",
    "36904": "Dialysis circuit thrombectomy/thrombolysis",
    "36905": "Dialysis circuit thrombectomy w/ angioplasty",
    "36906": "Dialysis circuit thrombectomy w/ stent",
    "36907": "Central dialysis segment angioplasty, add-on",
    "36908": "Central dialysis segment stent, add-on",
    "36909": "Dialysis circuit embolization, add-on",
  },
  TUMOR_ABLATION: {
    "47382": "Percutaneous RFA liver tumor",
    "47383": "Percutaneous cryoablation liver tumor",
    "50592": "Percutaneous RFA renal tumor",
    "50593": "Percutaneous cryoablation renal tumor",
    "32998": "Percutaneous RFA lung tumor",
    "32994": "Percutaneous cryoablation lung tumor",
    "20982": "Percutaneous RFA bone tumor",
    "20983": "Percutaneous cryoablation bone tumor",
  },
  PAIN_PALLIATIVE: {
    "22510": "Percutaneous vertebroplasty, cervicothoracic",
    "22511": "Percutaneous vertebroplasty, lumbosacral",
    "22512": "Vertebroplasty, additional level",
    "22513": "Kyphoplasty, thoracic",
    "22514": "Kyphoplasty, lumbar",
    "22515": "Kyphoplasty, additional level",
  },
  NEUROINTERVENTIONAL: {
    "61645": "Mechanical thrombectomy, intracranial",
    "61650": "Intra-arterial CNS therapy, initial",
    "61651": "Intra-arterial CNS therapy, additional",
  },
} as const;

export const IR_CPT_TIER_2_GUIDANCE = {
  "77001": "Fluoro guidance, central venous access",
  "77002": "Fluoro guidance, needle placement",
  "77003": "Fluoro guidance, spine/paraspinous",
  "77012": "CT guidance, needle placement",
  "77021": "MR guidance, needle placement",
  "77022": "MR guidance, tissue ablation",
  "76937": "US guidance, vascular access",
  "76942": "US guidance, needle placement",
} as const;

type CategoryKey = keyof typeof IR_CPT_TIER_1;

// Build flat lookup: code -> {category, description}.
const flat: Record<string, { category: CategoryKey; description: string }> = {};
for (const category of Object.keys(IR_CPT_TIER_1) as CategoryKey[]) {
  const group = IR_CPT_TIER_1[category];
  for (const [code, description] of Object.entries(group)) {
    flat[code] = { category, description };
  }
}

export const IR_CPT_TIER_1_CODES = new Set(Object.keys(flat));
export const IR_CPT_TIER_2_CODES = new Set(Object.keys(IR_CPT_TIER_2_GUIDANCE));

export function lookupIrCpt(
  code: string,
): { tier: 1; category: CategoryKey; description: string } | { tier: 2; description: string } | null {
  if (code in flat) {
    return { tier: 1, ...flat[code] };
  }
  if (code in IR_CPT_TIER_2_GUIDANCE) {
    return { tier: 2, description: IR_CPT_TIER_2_GUIDANCE[code as keyof typeof IR_CPT_TIER_2_GUIDANCE] };
  }
  return null;
}

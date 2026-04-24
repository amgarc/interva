// Build Interva CoE Physician Selection Rubric v4.0
// Output: /Users/amg/Desktop/Claude/Interva/Physicians CoE Rubric/Interva_CoE_Physician_Selection_Rubric_v4.docx
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak, TabStopType, TabStopPosition
} = require('docx');

const OUT = path.join(__dirname, 'Interva_CoE_Physician_Selection_Rubric_v4.docx');

// ---------- Helpers ----------
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFC9D1' };
const borders = { top: border, bottom: border, left: border, right: border };

function P(text, opts = {}) {
  if (Array.isArray(text)) {
    return new Paragraph({ ...opts, children: text });
  }
  return new Paragraph({ ...opts, children: [new TextRun(text || '')] });
}

function H1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function H2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function H3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });
}
function H4(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_4, children: [new TextRun(text)] });
}
function Bold(text) { return new TextRun({ text, bold: true }); }
function Ital(text) { return new TextRun({ text, italics: true }); }
function Run(text, opts = {}) { return new TextRun({ text, ...opts }); }
function Spacer() { return new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } }); }

function bullet(text, level = 0) {
  const children = typeof text === 'string' ? [new TextRun(text)] : text;
  return new Paragraph({ numbering: { reference: 'bullets', level }, children });
}
function num(text, level = 0) {
  const children = typeof text === 'string' ? [new TextRun(text)] : text;
  return new Paragraph({ numbering: { reference: 'numbers', level }, children });
}

// Table cell with padding + consistent borders
function tc(contents, opts = {}) {
  const children = Array.isArray(contents)
    ? contents
    : [typeof contents === 'string' ? P(contents) : contents];
  return new TableCell({
    borders,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: 'top',
    children,
  });
}

function headerCell(text, width) {
  return tc([P([new TextRun({ text, bold: true })])], { width, shading: 'E8EEF5' });
}

function makeTable(columnWidths, rows) {
  const total = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths,
    rows,
  });
}

// Shortcut: plain text table
function dataTable(columnWidths, header, rows) {
  const trs = [
    new TableRow({ children: header.map((t, i) => headerCell(t, columnWidths[i])), tableHeader: true }),
    ...rows.map(
      (row) => new TableRow({ children: row.map((cell, i) => tc(cell, { width: columnWidths[i] })) })
    ),
  ];
  return makeTable(columnWidths, trs);
}

// Callout-style paragraph (shaded block)
function callout(text, opts = {}) {
  // Create single-cell table to make a shaded block
  const width = 9360;
  return makeTable([width], [
    new TableRow({
      children: [
        new TableCell({
          borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: opts.accent || '1E4976' },
            bottom: border, left: border, right: border,
          },
          margins: { top: 140, bottom: 140, left: 180, right: 180 },
          width: { size: width, type: WidthType.DXA },
          shading: { fill: opts.fill || 'F2F6FA', type: ShadingType.CLEAR },
          children: Array.isArray(text) ? text : [typeof text === 'string' ? P(text) : text],
        }),
      ],
    }),
  ]);
}

// ---------- CONTENT ----------

const content = [];

// Title block
content.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: 'INTERVA HEALTH', bold: true, size: 36, color: '1E4976' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'Center of Excellence', size: 28, color: '334155' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'Physician Selection & Credentialing Rubric', bold: true, size: 30 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: 'Version 4.0  \u2022  April 2026  \u2022  Confidential', size: 20, color: '64748B', italics: true })],
  })
);

// Executive summary / purpose
content.push(
  H1('1. Purpose & Scope'),
  P([
    Bold('Interva Health'),
    Run(' operates a national, employer-direct Center of Excellence (CoE) network for Interventional Radiology (IR). This rubric is the framework used to evaluate prospective IR physicians for network designation. It is administered over a ~2\u20134 week process combining a written application, independent third\u2010party verification, and a 30\u2010minute structured conversation.'),
  ]),
  P([
    Run('Version 4 reflects operational refinements from the v3 pilot: a new '),
    Bold('Background'),
    Run(' section to capture non\u2010scored recruiting context; auto\u2010calculated Dimension A scoring; an updated Dimension B equipment checklist; reorganized Dimension C; and a streamlined Dimension D focused on bundled\u2010payment alignment, patient experience, and scheduling + capacity. Total scored points: '),
    Bold('93.'),
  ]),
  Spacer(),
);

// ---- Section 2: Baseline Qualifications ----
content.push(
  H1('2. Baseline Qualifications (Pass / Fail \u2013 Disqualifying)'),
  callout([
    P([Bold('Failure on ANY single item below disqualifies the physician immediately.')]),
    P('Interva performs all third-party verification (NPDB, OIG-LEIE, SAM.gov, ABMS, state medical board).'),
  ], { accent: 'B45309', fill: 'FEF3C7' }),
  Spacer()
);

const baselineWidths = [500, 2300, 4060, 2500];
content.push(
  dataTable(
    baselineWidths,
    ['#', 'Requirement', 'Definition', 'Verification'],
    [
      ['1', 'ABMS Board Certification (VIR or IR)', 'Active ABMS certification in Vascular & Interventional Radiology (VIR) or Interventional Radiology (IR). Diagnostic Radiology alone, without IR subspecialty, does not qualify. Expired or lapsed certification disqualifies.', 'ABR / ABMS primary source verification'],
      ['2', 'Unrestricted Medical License', 'Unrestricted license in every state of practice. Any current restriction, suspension, probation, or surrender disqualifies.', 'State medical board query per state of practice'],
      ['3', 'No Disciplinary Action, Sanctions, or Program Exclusions', 'No current or past disciplinary action by a state medical board or specialty board; no hospital privilege restriction or revocation; no DEA action; no exclusion from a Federal healthcare program (Medicare, Medicaid, OIG-LEIE, SAM.gov); no debarment.', 'NPDB, OIG-LEIE, and SAM.gov queries'],
      ['4', 'Malpractice Coverage & Claims History', 'Active malpractice coverage. No open judgments >$250K. No pattern of more than 3 closed claims in the preceding 5 years.', 'Certificate of insurance; signed claims-history attestation'],
      ['5', 'Active Clinical Practice Authorization', 'At least one of: state-licensed Office-Based Lab (OBL); AAAHC or Joint Commission-accredited Ambulatory Surgery Center (ASC); or active hospital privileges. Hospital privileges are no longer required.', 'State OBL license, ASC accreditation certificate, or hospital privilege letter'],
      ['6', 'DEA Registration (if applicable)', 'Active DEA registration is required only if the practice uses moderate or deep sedation. Mark Pass if not applicable.', 'DEA CSOS verification'],
    ]
  )
);
content.push(
  Spacer(),
  callout([
    P([Bold('Design note on gate 3 wording (v4).'), Run(' The v3 phrasing ("No Exclusions (NPDB, OIG-LEIE, SAM.gov)") named databases rather than behavior. V4 uses credentialing-familiar language: disciplinary action, sanctions, privilege restrictions, DEA actions, Federal program exclusion. The verification mechanism (NPDB/OIG/SAM) is preserved, now named in the Verification column.')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
);

// ---- Section 3: Physician Background (NEW, not scored) ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('3. Physician Background (Not Scored)'),
  P('This section is captured during initial outreach and the structured conversation. It is not scored; it informs Interva recruiting, network fit, referral routing, and locum opportunity discussions.'),
  Spacer(),
  H2('3.1 Education & Training'),
  P('Captured:'),
  bullet('Medical school and graduation year'),
  bullet('Diagnostic Radiology residency (institution, years)'),
  bullet('IR / VIR fellowship (institution, years)'),
  Spacer(),
  H2('3.2 Practice Experience'),
  P('Captured:'),
  bullet('Years in practice post-fellowship'),
  bullet('Current practice setting (independent OBL, hospital, academic, multi-specialty group, etc.)'),
  bullet('Prior practice history, settings, and durations'),
  Spacer(),
  H2('3.3 Publications & Academic Activity'),
  P('Captured:'),
  bullet('Count of peer-reviewed publications'),
  bullet('Notable publications and research interests'),
  bullet('SIR / ACR committee roles, speaking engagements, fellowship teaching'),
  Spacer(),
  H2('3.4 Selective Locum Interest'),
  P('Introduced during the recruiting conversation as part of Interva\u2019s value proposition. Three teasing prompts:'),
  num('Interva periodically places designated physicians in selective domestic locum engagements at partner OBLs across the US \u2014 short blocks, pre-credentialed, additional income stream. Would that interest you?'),
  num('Do you currently hold (or would you be open to pursuing) licensure in additional states? Which ones stand out?'),
  num('Interva also places IR physicians in selective international engagements \u2014 typically at partner sites in the Middle East, Southeast Asia, or Latin America for 2\u20134 week blocks. Is that something you\u2019d want to hear more about?'),
  Spacer(),
  P('Recorded for each physician:'),
  bullet('Interest level \u2013 domestic selective locums (Strong interest / Open / Not interested)'),
  bullet('Interest level \u2013 international selective locums (Strong interest / Open / Not interested)'),
  bullet('Additional state licensure (held or willing to pursue)'),
  bullet('Free-text locum discussion notes (regions, timing, constraints, compensation sensitivities)'),
  Spacer(),
);

// ---- Section 4: Scored Rubric Overview ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('4. Scored Rubric (93 Points)'),
  P([
    Bold('Total available: 93 points'),
    Run(' across four dimensions. Tier thresholds are evaluated as percentages of the total available (not absolute scores), so the framework scales cleanly as the rubric is refined.'),
  ]),
  Spacer(),
);

// Dimension summary table
const dimSummaryWidths = [2000, 1100, 6260];
content.push(
  dataTable(
    dimSummaryWidths,
    ['Dimension', 'Max Points', 'What it measures'],
    [
      ['A. Procedure Volume & Case Mix', '30', 'Aggregate Tier 1 volume (A1, auto-calculated) and service-line breadth (A2, checklist-based)'],
      ['B. Facility Infrastructure & Operational Readiness', '24', 'Site-of-service capability, equipment checklist, staffing & scheduling'],
      ['C. Clinical Quality & Outcomes Orientation', '25', 'Quality infrastructure & registry participation, complication awareness, PRO commitment'],
      ['D. Model Alignment & Patient Experience', '14', 'Bundled payment understanding, patient experience orientation, scheduling & capacity'],
      [{ children: [P([Bold('Total')])] }, { children: [P([Bold('93')])] }, ''],
    ]
  ),
  Spacer(),
);

// Tier thresholds
content.push(
  H2('4.1 Designation Tiers'),
  dataTable(
    [2600, 3000, 3760],
    ['Designation', 'Threshold', 'Implications'],
    [
      ['Tier 1 \u2013 Premier CoE', '\u226585% of total (\u226579 / 93) AND no dimension below 50%', 'Priority referral routing; featured in employer-facing materials; performance bonus pool eligibility; Clinical Advisory Board invitation; first access to new service line launches.'],
      ['Tier 2 \u2013 Designated CoE', '\u226565% of total (\u226560 / 93) AND no dimension below 40%', 'Full CoE designation; standard referral routing; standard bundled-payment terms; eligible for Tier 1 at annual review.'],
      ['Conditional (Emerging Practice)', 'A1 score in 5\u20138 band with strong B, C, D performance', '6-month provisional designation with defined milestones (volume ramp, VIRTEX enrollment, PRO protocol adoption, OBL buildout).'],
      ['Not Designated', '<55% of total, or any dimension <40%', 'Written feedback identifying gaps; may reapply after 6 months; Interva provides improvement guidance.'],
    ]
  ),
  Spacer(),
);

// ---- Dimension A ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('5. Dimension A: Procedure Volume & Case Mix (30 points)'),
  P([
    Bold('Rationale. '),
    Run('Volume is the single most evidence-supported predictor of outcomes in procedural medicine. This dimension scores both depth (aggregate annual volume, A1) and breadth (service lines performed, A2), with an explicit Emerging Practice pathway for early-stage OBL operators. In v4, both sub-scores are auto-calculated from the physician\u2019s inputs.'),
  ]),
  Spacer(),
  H2('5.1 Tier 1 Service Lines (9)'),
);

const procRows = [
  ['Uterine Fibroid Embolization (UFE)', '<4%', 'UFS-QOL'],
  ['Prostate Artery Embolization (PAE)', '<5%', 'IPSS + IPSS-QOL'],
  ['Hemorrhoidal Artery Embolization (HAE)', '<5%', 'PROMIS GI + HBS'],
  ['Genicular Artery Embolization (GAE) \u2014 knee OA', '<3%', 'VAS + WOMAC'],
  ['PAD Revascularization (incl. diabetic foot / wound)', '<3%', 'VascuQoL-6'],
  ['Dialysis Access Maintenance', '<2%', 'KDQOL-SF12'],
  ['Varicocele Embolization', '<2%', 'PROMIS Pain Interference SF'],
  ['Pelvic Vein Embolization', '<3%', 'PROMIS Pain Interference SF'],
  ['Percutaneous AVF Creation (pAVF)', '<5%', 'KDQOL-SF12'],
];
content.push(
  dataTable(
    [4460, 2200, 2700],
    ['Service line', 'SIR major complication threshold', 'Example PRO instrument'],
    procRows
  ),
  Spacer(),
  callout([
    P([Bold('V4 changes to service lines.'), Run(' PAD and Diabetic Foot / Wound Revascularization are now a single service line. Genicular Artery Embolization (GAE) is added as a 9th Tier 1 procedure with VAS and WOMAC as recommended PRO instruments.')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
);

// A1
content.push(
  H2('5.2 A1 \u2013 Aggregate Tier 1 Volume (20 points)'),
  P([
    Bold('Auto-calculated. '),
    Run('The physician reports trailing-12-month case counts per procedure. The tool sums these and applies the scoring bands below. A1 requires the physician to meet the minimum volume threshold in at least one Tier 1 procedure to score above zero. Per-procedure minimums are configured globally in the tool (sensible SIR / NICE / SVS-informed defaults are provided and editable).'),
  ]),
  Spacer(),
  dataTable(
    [1500, 3500, 4360],
    ['Points', 'Aggregate Tier 1 volume', 'Notes'],
    [
      ['17\u201320', '\u2265150 cases / year', 'Meets minimum in at least one procedure.'],
      ['13\u201316', '75\u2013149 cases / year', 'Meets minimum in at least one procedure.'],
      ['9\u201312', '40\u201374 cases / year', 'Meets minimum in at least one procedure.'],
      ['5\u20138', '20\u201339 cases / year', 'Emerging Practice pathway. Meets minimum in at least one procedure.'],
      ['0\u20134', '<20 cases / year', 'Does not meet minimum in any procedure.'],
    ]
  ),
  Spacer(),
);

// A2
content.push(
  H2('5.3 A2 \u2013 Service Line Breadth (10 points)'),
  P([
    Bold('Auto-calculated from checklist. '),
    Run('During credentialing the physician indicates which Tier 1 service lines they actively perform (checkbox per service line). A2 is derived from the count.'),
  ]),
  Spacer(),
  dataTable(
    [1500, 7860],
    ['Points', 'Service lines captured'],
    [
      ['10', '4 or more Tier 1 service lines'],
      ['8', '3 Tier 1 service lines'],
      ['6', '2 Tier 1 service lines'],
      ['3', '1 Tier 1 service line (focused specialist)'],
      ['0', 'None'],
    ]
  ),
  Spacer(),
  callout([
    P([Bold('Focused specialist note.'), Run(' A physician doing 100+ UFE cases / year with exceptional outcomes but no other Tier 1 volume scores 3 in A2. Combined with a strong A1 (13\u201316), achieves 16\u201319 of 30 in Dimension A \u2014 sufficient for designation when paired with strong performance in Dimensions B, C, and D. Breadth score reflects a network routing constraint (limited referral utility), not a quality judgment. Interva may designate focused specialists for specific service line routing where geographic coverage requires it.')]),
  ]),
  Spacer(),
);

// ---- Dimension B ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('6. Dimension B: Facility Infrastructure & Operational Readiness (24 points)'),
  P([
    Bold('Rationale. '),
    Run('Interva\u2019s savings model depends on site-of-service shift from hospital to OBL / ASC. This dimension evaluates operational capability with specific, verifiable requirements calibrated to what a well-run OBL practice would reasonably possess.'),
  ]),
  Spacer(),
  H2('6.1 B1 \u2013 Site-of-Service Capability (12 points)'),
  dataTable(
    [1400, 4600, 3360],
    ['Points', 'Practice setting', 'Verification'],
    [
      ['11\u201312', 'Owns / operates state-licensed OBL or accredited ASC; performs \u226575% of Tier 1 cases there.', 'State OBL license # or ASC accreditation certificate; case distribution attestation'],
      ['8\u201310', 'Has access to qualifying OBL / ASC and performs 25\u201374% of Tier 1 cases there; remainder hospital-based.', 'Facility documentation + case distribution attestation'],
      ['5\u20137', 'Hospital-based only, but has an active OBL / ASC buildout plan: signed LOI, active lease, or equipment on order with target operational date within 12 months.', 'LOI, lease agreement, or equipment purchase order'],
      ['3\u20134', 'Hospital-based; willing to transition Interva cases to qualifying OBL / ASC but has not yet committed capital.', 'Stated in structured interview'],
      ['0\u20132', 'Hospital-based only; no pathway or willingness to transition.', 'Stated in structured interview'],
    ]
  ),
  Spacer(),
);

// B2
content.push(
  H2('6.2 B2 \u2013 Equipment & Clinical Infrastructure (7 points)'),
  P([Bold('Each item scored 1 (present) or 0 (absent). Total capped at 7.')]),
  dataTable(
    [500, 3600, 5260],
    ['#', 'Requirement', 'What qualifies'],
    [
      ['1', 'Fixed or portable C-arm fluoroscopy with DSA', 'Siemens Artis, GE OEC 9900/Elite, Philips Azurion, Ziehm, or equivalent with digital subtraction angiography capability.'],
      ['2', 'Vascular ultrasound with Doppler', 'Dedicated vascular ultrasound unit; used for access, guidance, and follow-up assessment.'],
      ['3', 'Moderate sedation protocol with continuous monitoring', 'Continuous pulse oximetry, cardiac monitoring, written sedation protocol; ACLS-certified provider present during all procedures.'],
      ['4', 'Post-procedure recovery area with monitored observation', 'Dedicated recovery bay with nursing staff; \u22652-hour observation capability; written discharge criteria protocol.'],
      ['5', 'Emergency transfer agreement with acute-care hospital', 'Written transfer agreement with hospital reachable within 30-minute ground transport; current and signed.'],
      ['6', 'Crash cart with resuscitation medications and defibrillator', 'On-site, inspected per facility policy (minimum quarterly); staff trained in use.'],
      ['7', 'Radiation safety program', 'Badge monitoring, dose tracking, shielding available, written radiation safety protocol per ACR / SIR guidelines.'],
    ]
  ),
  Spacer(),
  callout([
    P([Bold('V4 change.'), Run(' Intraprocedural cross-sectional imaging (CBCT / adjacent CT / IVUS) was removed as a required equipment item. Most OBL operators do not have it on-site, and many of its use-cases can be addressed with high-quality ultrasound and DSA. B2 is now 7 items (formerly 8); the cross-sectional imaging N/A reallocation rule is retired.')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
);

// B3
content.push(
  H2('6.3 B3 \u2013 Staffing & Operational Capacity (5 points)'),
  dataTable(
    [1400, 7960],
    ['Points', 'Staffing & scheduling configuration'],
    [
      ['5', 'Dedicated IR clinical team: IR tech or RN circulator, recovery nurse, front-office coordinator; accommodates new Interva consult within 72 hours of referral; named point of contact for Interva scheduling.'],
      ['3\u20134', 'Shared staffing model; reliably schedules Interva cases within 1 week; named point of contact identified for Interva referrals.'],
      ['1\u20132', 'Ad hoc staffing; scheduling capacity uncertain; general willingness but no dedicated Interva contact or defined scheduling protocol.'],
      ['0', 'Insufficient staffing to accommodate additional case volume; cannot identify pathway to serve Interva referrals.'],
    ]
  ),
  Spacer(),
);

// ---- Dimension C ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('7. Dimension C: Clinical Quality & Outcomes Orientation (25 points)'),
  P([
    Bold('Rationale. '),
    Run('SIR publishes procedure-specific complication thresholds and technical success benchmarks. Most OBL-based IR physicians do not formally track against these thresholds today \u2014 that is the gap Interva fills. This dimension scores current quality posture (C1 infrastructure, C2 complication awareness) and readiness to adopt Interva\u2019s PRO protocol (C3).'),
  ]),
  Spacer(),
  callout([
    P([Bold('V4 reorder.'), Run(' In v3, C1 was Complication Awareness and C2 was Quality Infrastructure. Those are swapped in v4: C1 is now Quality Infrastructure (7 pts), C2 is Complication Awareness (8 pts). Rationale: infrastructure is more objectively verifiable and reduces variability in scoring compared to rate self-reports.')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
);

// C1 = Quality Infrastructure
content.push(
  H2('7.1 C1 \u2013 Quality Infrastructure & Registry Participation (7 points)'),
  P([Bold('Additive scoring. '), Run('Most independent OBL operators will score 0\u20132 today; this is expected and is not disqualifying. Interva\u2019s VIRTEX enrollment support and standardized reporting implementation are part of post-designation onboarding.')]),
  Spacer(),
  dataTable(
    [5500, 1200, 2660],
    ['Item', 'Points', 'Verification'],
    [
      ['Participates in SIR VIRTEX Registry or SIR QCDR', '3', 'Registry enrollment confirmation or MIPS QCDR reporting documentation'],
      ['Uses SIR Standardized Report Templates (v3.1) or equivalent structured reporting', '1', 'Sample procedural report or attestation'],
      ['Internal M&M / quality committee with documented meetings (at least quarterly)', '1', 'Meeting schedule or minutes (title page only)'],
      ['Participates in or has published IR outcomes research (peer-reviewed or presented)', '1', 'Publication list, abstract, or presentation documentation'],
      ['Uses HI-IQ or equivalent electronic QA logging system', '1', 'System access confirmation or screenshot'],
    ]
  ),
  Spacer(),
);

// C2 = Complication Awareness
content.push(
  H2('7.2 C2 \u2013 Complication Awareness (8 points)'),
  P([
    Bold('Scored on awareness and tracking methodology, not on a specific rate. '),
    Run('Calculating exact percentages is difficult without tracking infrastructure, and high-performing operators typically report rates near 0%. Use the SIR thresholds (below) as directional context during the conversation.'),
  ]),
  Spacer(),
  callout([
    P([Bold('SIR Complication Classification (Grade C\u2013F = major).')]),
    P('A: No therapy, no consequence.'),
    P('B: Nominal therapy, no consequence; includes overnight observation.'),
    P('C: Requires therapy; minor hospitalization (<48 hours).'),
    P('D: Requires major therapy; unplanned increase in level of care; extended hospitalization (>48 hours).'),
    P('E: Permanent adverse sequelae.'),
    P('F: Death.'),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
  dataTable(
    [1400, 7960],
    ['Points', 'Scoring anchor'],
    [
      ['7\u20138', 'Cites specific complication rates from own practice that are plausible and at / below SIR thresholds; demonstrates active tracking methodology (logbook, database, EHR query, or registry).'],
      ['5\u20136', 'Provides directional estimates that are clinically plausible; acknowledges tracking limitations; demonstrates awareness of SIR thresholds and AE classification.'],
      ['3\u20134', 'Aware of complication categories but cannot provide specific rates; expresses willingness to begin systematic tracking.'],
      ['1\u20132', 'Vague about complications; limited awareness of SIR quality framework.'],
      ['0', 'Dismissive of quality tracking; unable or unwilling to discuss complication experience.'],
    ]
  ),
  Spacer(),
  callout([
    P([Bold('V4 change.'), Run(' The v3 per-procedure complication rate input fields are retired. Reviewers no longer ask the physician to state a specific rate per procedure. Instead, the SIR thresholds are shared as context and the conversation scores the physician\u2019s awareness and tracking methodology.')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
);

// C3 PRO
content.push(
  H2('7.3 C3 \u2013 PRO Commitment (10 points)'),
  P([Bold('Post-designation Interva deploys validated PRO instruments via the concierge platform. '), Run('Physician\u2019s integration point: enroll patients at or before the consultation visit so baseline PRO data can be collected. Interva supplies tablet, paper, or EHR-integrated collection (Epic / athenahealth / eCW); the physician picks what fits their workflow.')]),
  Spacer(),
  H3('Example validated PRO instruments by service line'),
  P([Ital('These are examples Interva has deployed. Other validated instruments may substitute as practice patterns evolve.')]),
  dataTable(
    [3500, 3500, 2360],
    ['Service line', 'Example instrument', 'Timepoints'],
    [
      ['UFE (Fibroids)', 'UFS-QOL (37 items)', 'Baseline, 30d, 90d, 180d'],
      ['PAE (BPH)', 'IPSS + IPSS-QOL', 'Baseline, 30d, 90d, 180d'],
      ['HAE', 'PROMIS GI + HBS', 'Baseline, 30d, 90d'],
      ['GAE (Knee osteoarthritis)', 'VAS + WOMAC', 'Baseline, 30d, 90d, 180d'],
      ['Varicocele / Pelvic Vein', 'PROMIS Pain Interference SF', 'Baseline, 30d, 90d'],
      ['All procedures', 'Interva Patient Satisfaction (NPS)', '7d, 30d'],
    ]
  ),
  Spacer(),
  callout([
    P([Bold('V4 changes to C3.'), Run(' (1) The instrument list is now framed as examples, not prescribed. (2) Added GAE with VAS and WOMAC. (3) HAE updated to PROMIS GI + HBS (Hemorrhoid Bleeding Score). (4) Explicit rows for PAD, Dialysis Access, and pAVF are removed from the example table \u2014 validated instruments remain acceptable when practice patterns warrant them.')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
  H3('C3 Scoring'),
  dataTable(
    [1400, 7960],
    ['Points', 'Scoring anchor'],
    [
      ['9\u201310', 'Currently collects at least one validated PRO instrument for primary procedure(s); can demonstrate baseline and follow-up data; enthusiastic about full Interva protocol adoption.'],
      ['6\u20138', 'Does not collect formal PROs but tracks functional outcomes informally; commits to full Interva protocol; understands specific instruments and workflow integration.'],
      ['3\u20135', 'No current outcomes tracking beyond standard clinical follow-up; willing to adopt Interva protocol; asks constructive questions about implementation burden.'],
      ['1\u20132', 'Minimal interest in outcomes tracking; concerned about administrative burden; needs significant persuasion.'],
      ['0', 'Unwilling to commit to any standardized outcomes collection.'],
    ]
  ),
  Spacer(),
);

// ---- Dimension D ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('8. Dimension D: Model Alignment & Patient Experience (14 points)'),
  P([
    Bold('Assessed through a structured 30-minute conversation. '),
    Run('Interva\u2019s clinical network team uses the interview questions and scoring anchors below. The conversation also serves as Interva\u2019s opportunity to present its value proposition.'),
  ]),
  Spacer(),
  callout([
    P([Bold('V4 changes to Dimension D.'), Run(' (1) The Appropriateness & Clinical Integrity sub-dimension (v3 D2, 6 pts) is retired. It proved difficult to score consistently on a 30-minute call and better belongs to post-designation performance monitoring. (2) The Operational Responsiveness sub-dimension (v3 D4) is expanded to cover both scheduling responsiveness and absolute capacity, and is renamed Scheduling & Capacity. Dimension D max is now 14 (previously 20).')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
);

// D1
content.push(
  H2('8.1 D1 \u2013 Bundled Payment Understanding & Acceptance (6 points)'),
  H3('Interview questions'),
  num('Have you worked in any bundled payment, capitated, or value-based arrangement before?'),
  num('Interva pays a single per-episode fee covering the procedure, facility costs, and any complication management within 30 days. How do you view that structure?'),
  num('What concerns, if any, do you have about bearing episode-level risk for complications?'),
  Spacer(),
  callout([
    P([Bold('Talking point \u2013 stop-loss protection.'), Run(' The bundled payment includes a defined stop-loss mechanism. Complications exceeding a per-episode cost ceiling (specified in the IR Physician Participation Agreement, Exhibit A) are covered by Interva\u2019s stop-loss. Maximum physician financial exposure per episode is capped at the negotiated bundle price. Complications requiring inpatient transfer that generate facility charges beyond the OBL are handled through the stop-loss, not the physician\u2019s bundle.')]),
  ], { accent: 'B45309', fill: 'FEF3C7' }),
  Spacer(),
  H3('D1 Scoring'),
  dataTable(
    [1400, 7960],
    ['Points', 'Scoring anchor'],
    [
      ['5\u20136', 'Prior bundled / VBC experience OR clear understanding of episode-based risk; articulates how their practice model supports it (low complication rates, OBL cost structure); engages constructively with pricing.'],
      ['3\u20134', 'No prior experience but grasps the concept after explanation; asks smart questions about mechanics and stop-loss; open to learning.'],
      ['1\u20132', 'Significant concerns; needs substantial education before committing.'],
      ['0', 'Fundamentally opposed to per-episode risk; insists on fee-for-service.'],
    ]
  ),
  Spacer(),
);

// D2 = Patient Experience
content.push(
  H2('8.2 D2 \u2013 Patient Experience Orientation (5 points)'),
  H3('Interview questions'),
  num('Walk me through the patient journey when someone is referred for a UFE / PAE / PAD procedure. What does pre-procedure counseling look like?'),
  num('What does post-procedure follow-up look like? When do you next contact the patient after discharge?'),
  num('Do you have any patient testimonials, reviews, or informal feedback you\u2019d be willing to share?'),
  num('Interva provides a concierge patient experience layer. How does that fit with your current workflow?'),
  Spacer(),
  callout([
    P([Bold('Talking point \u2013 concierge integration.'), Run(' Interva\u2019s concierge team administers the patient experience survey (7d and 30d) via text and email. The physician\u2019s office is not burdened with survey administration. PRO collection uses tablet, paper, or EHR integration; the physician picks the method that fits their workflow.')]),
  ], { accent: 'B45309', fill: 'FEF3C7' }),
  Spacer(),
  H3('D2 Scoring'),
  dataTable(
    [1400, 7960],
    ['Points', 'Scoring anchor'],
    [
      ['5', 'Structured patient journey: dedicated pre-procedure consultation; informed consent comparing IR vs. surgical options; post-procedure follow-up protocol (same-day call, 7-day check-in, 30-day visit). Has existing testimonials or positive reviews. Welcomes Interva concierge integration.'],
      ['3\u20134', 'Genuine care for patient experience but informal approach. Post-procedure follow-up exists but is ad hoc. Open to Interva concierge workflow.'],
      ['1\u20132', 'Minimal patient engagement; relies heavily on referring physician for pre / post communication.'],
      ['0', 'Dismissive of patient experience as a quality dimension; resistant to external engagement workflow.'],
    ]
  ),
  Spacer(),
);

// D3 = Scheduling & Capacity
content.push(
  H2('8.3 D3 \u2013 Scheduling & Capacity (3 points)'),
  H3('Interview questions'),
  num('What\u2019s your typical turnaround time from referral to scheduled consult?'),
  num('From consult to procedure, what\u2019s your typical wait time?'),
  num('How many additional Interva cases per month could you take on in the next 90 days without disrupting current operations?'),
  num('If volume grows beyond that, what levers (staffing, block time, additional day per week) could you pull to scale?'),
  Spacer(),
  callout([
    P([Bold('Context \u2013 why this matters.'), Run(' Interva commits a defined referral volume to designated physicians. Both scheduling responsiveness (time-to-consult, time-to-procedure) and absolute capacity (cases per month the physician can absorb) matter \u2014 a fast scheduler at full capacity is less useful to the network than a moderate scheduler with real headroom.')]),
  ], { accent: '0369A1', fill: 'E0F2FE' }),
  Spacer(),
  H3('D3 Scoring'),
  dataTable(
    [1400, 7960],
    ['Points', 'Scoring anchor'],
    [
      ['3', 'Consistently schedules new consults within 72 hours and procedures within 2 weeks; can absorb 10+ additional Interva cases per month without operational strain.'],
      ['2', 'Can schedule within 1 week and procedure within 4 weeks; can absorb 3\u201310 additional cases per month; some ramp-up required.'],
      ['1', 'Scheduling uncertain OR capacity limited (fewer than 3 additional cases per month); would need operational adjustments to take Interva volume.'],
      ['0', 'Cannot accommodate additional referral volume; practice is at or over capacity.'],
    ]
  ),
  Spacer(),
);

// ---- Section 9: Post-Designation Monitoring ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('9. Post-Designation Performance Monitoring'),
  P('These metrics sustain CoE designation. Communicated during credentialing but not scored at entry. Performance data collection begins at the first Interva-referred case.'),
  Spacer(),
  dataTable(
    [2400, 3400, 1500, 2060],
    ['Metric', 'Method', 'Frequency', 'Threshold'],
    [
      ['30-day major complication rate (SIR Grade C\u2013F), procedure-specific', 'Physician reporting via Interva platform + claims-based verification', 'Per episode; quarterly aggregate', 'At or below SIR thresholds'],
      ['30-day unplanned readmission or reintervention', 'Claims data reconciliation (TPA feed captures hospital-side events independently)', 'Per episode; quarterly aggregate', '<5% across Tier 1; procedure-specific per SIR'],
      ['Technical success rate', 'Procedural report (SIR standardized template)', 'Per episode; quarterly aggregate', 'Per SIR thresholds'],
      ['Patient-reported outcomes', 'Interva concierge-administered at defined timepoints', 'Per episode; semi-annual aggregate', 'Clinically meaningful improvement vs. baseline (procedure-specific MCID)'],
      ['Patient satisfaction / NPS', 'Interva Patient Experience Survey at 7d and 30d', 'Per episode; quarterly aggregate', 'NPS >50; investigation below'],
      ['Time-to-consult', 'Interva platform timestamps', 'Per referral', 'Within stated window (72h / 1 week per designation)'],
      ['Capacity utilization', 'Interva platform + physician attestation', 'Quarterly', 'Tracks against stated D3 capacity; systematic decline triggers review'],
    ]
  ),
  Spacer(),
  H2('9.1 Complication Attribution for Post-OBL Transfer Cases'),
  P('When a complication results in hospital transfer, the OBL physician may have limited visibility into the inpatient course and 30-day outcome. Interva addresses this through a TPA claims feed that captures hospital-side events independently, and through Interva\u2019s clinical quality team performing hospital-side severity grading using claims data and discharge summaries. The physician is not penalized for hospital-side outcomes beyond their clinical control (e.g., hospital-acquired infections post-transfer).'),
  Spacer(),
  H2('9.2 Performance Review & Designation Continuity'),
  P('CoE designation is reviewed annually. Physicians meeting all thresholds maintain designation automatically. One or more metrics below threshold triggers a 90-day collaborative improvement process. Persistent underperformance (two consecutive quarterly reviews below threshold on the same metric, or any single SIR Grade E\u2013F event) triggers formal designation review. Interva\u2019s philosophy is developmental \u2014 the goal is to help every designated provider succeed.'),
  Spacer(),
);

// ---- Section 10: Process & Timeline ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('10. Process & Timeline'),
  P('Total physician time investment: approximately 1 hour across all phases.'),
  Spacer(),
  dataTable(
    [1400, 1400, 5100, 1460],
    ['Phase', 'Timeline', 'Activity', 'Physician time'],
    [
      ['Outreach', 'Day 1', 'Physician receives Interva CoE overview one-pager: value proposition front and center, including bundled payment structure, stop-loss protection summary, and an introduction to selective locum opportunities.', '5 min'],
      ['Application', 'Days 1\u201310', 'Practice profile questionnaire (Dimensions A, B, C); background section (education, prior practice, publications, locum interest); malpractice certificate; signed attestation.', '20\u201330 min'],
      ['Verification', 'Days 3\u201314', 'Interva runs NPDB, OIG, SAM, ABMS, state license queries; baseline gates evaluated internally.', '0 min'],
      ['Structured call', 'Days 10\u201321', '30-minute call covering Dimensions C and D; Interva presents value proposition, stop-loss mechanics, and locum pathways.', '30 min'],
      ['Scoring', 'Days 14\u201328', 'Two independent reviewers score rubric; \u00b110% point divergence triggers third reviewer; designation decision.', '0 min'],
      ['Notification', 'Days 21\u201330', 'Physician notified with score breakdown and written feedback; designated physicians receive bundled pricing term sheet and onboarding packet.', '5\u201310 min'],
    ]
  ),
  Spacer(),
);

// ---- Section 11: Physician Value Proposition ----
content.push(
  H1('11. Physician Value Proposition'),
  P('Communicated at outreach and reinforced during the structured call. The credentialing process itself is a brand statement \u2014 the physician should feel recruited into a first-of-its-kind network, not subjected to an audit.'),
  Spacer(),
  num('Guaranteed referral volume of pre-screened, pre-authorized patients routed directly to the physician\u2019s practice from self-insured employer plan members.'),
  num('Clean bundled payment with defined stop-loss protection.'),
  num('National CoE designation as part of the first IR-specific Center of Excellence network in the United States \u2014 a credential marketable to the physician\u2019s own referral base.'),
  num('Outcomes data platform that positions the physician as a leader in demonstrating IR\u2019s superiority with rigorous, published-quality data.'),
  num('Selective domestic and international locum opportunities at partner OBLs \u2014 short blocks, pre-credentialed, additional income stream.'),
  num('Zero member cost-sharing for patients referred through Interva, removing the largest barrier to conversion.'),
  num('Data privacy protections: physician-level performance data is used for quality improvement and employer reporting only, never for competitive referral routing decisions between network providers.'),
  Spacer(),
);

// ---- Section 12: v3 → v4 Changelog ----
content.push(
  new Paragraph({ children: [new PageBreak()] }),
  H1('12. Changelog \u2014 v3 to v4'),
  P('Concise summary of every substantive change incorporated into v4. The tool used by the credentialing team reflects all of these.'),
  Spacer(),
  H2('Baseline Qualifications'),
  bullet('Gate 3 rewritten as "No disciplinary action, sanctions, or program exclusions." Credentialing-familiar language replaces the database-centric v3 phrasing. Verification mechanism (NPDB, OIG-LEIE, SAM.gov) is preserved.'),
  Spacer(),
  H2('New Section \u2014 Physician Background'),
  bullet('Added a non-scored Background section capturing education, practice history, publications, additional state licensure, and locum interest (domestic and international). Informs recruiting and network fit, not scored.'),
  Spacer(),
  H2('Dimension A \u2014 Procedure Volume & Case Mix'),
  bullet('PAD Endovascular Revascularization and Diabetic Foot / Wound Revascularization merged into a single service line: "PAD Revascularization (incl. diabetic foot / wound)."'),
  bullet('Genicular Artery Embolization (GAE) added as the 9th Tier 1 service line; complication threshold <3%; example PRO instruments VAS and WOMAC.'),
  bullet('A1 is now auto-calculated from trailing-12-month volumes. Band selection and manual override removed.'),
  bullet('A2 is now derived from a service-line checklist (count of service lines the physician performs) rather than from volume-minimum thresholds.'),
  Spacer(),
  H2('Dimension B \u2014 Facility Infrastructure'),
  bullet('Intraprocedural cross-sectional imaging (CBCT / adjacent CT / IVUS) removed from the B2 equipment checklist. B2 max is now 7 (was 8); the N/A reallocation rule is retired. Dimension B max is now 24 (was 25).'),
  Spacer(),
  H2('Dimension C \u2014 Clinical Quality & Outcomes'),
  bullet('C1 and C2 are swapped in display order. C1 is now Quality Infrastructure & Registry Participation (7 pts). C2 is now Complication Awareness (8 pts).'),
  bullet('Per-procedure complication rate input fields retired. C2 scores awareness and tracking methodology, not a specific physician-stated rate per procedure.'),
  bullet('C3 PRO instrument table reframed as examples, not prescribed instruments.'),
  bullet('GAE added to C3 with VAS and WOMAC.'),
  bullet('HAE instrument updated to PROMIS GI + HBS.'),
  bullet('Explicit rows for PAD, Dialysis Access, and pAVF removed from the example table (validated instruments remain acceptable when practice patterns warrant them).'),
  Spacer(),
  H2('Dimension D \u2014 Model Alignment & Patient Experience'),
  bullet('D2 (Appropriateness & Clinical Integrity, 6 pts) retired. Appropriateness is now addressed via post-designation performance monitoring (10\u201340% redirect rate range).'),
  bullet('D4 renamed D3 Scheduling & Capacity. Scope expanded to include absolute capacity headroom (cases per month the physician can absorb), not just scheduling speed. Interview questions and scoring anchors updated accordingly.'),
  bullet('Dimension D max is now 14 (was 20).'),
  Spacer(),
  H2('Scoring & Designation'),
  bullet('Total scored points: 93 (was 100).'),
  bullet('Tier thresholds now evaluated as percentages of total (\u226585% for Tier 1, \u226565% for Tier 2, <55% for Not Designated) so the framework scales cleanly as future refinements occur.'),
  Spacer(),
  H2('Tooling'),
  bullet('Interva-built credentialing tool supports the full v4 rubric, with evidence file attachment on each baseline gate (ABMS certificate, license query, NPDB / OIG / SAM screenshots, malpractice COI, OBL license, DEA registration).'),
  bullet('Live total and tier determination update automatically during scoring.'),
  bullet('Dashboard tracks all candidates in pipeline; backup export includes attachments.'),
);

// ---- Document ----
const doc = new Document({
  creator: 'Interva Clinical Network Team',
  title: 'Interva CoE Physician Selection Rubric v4.0',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: '1E4976' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '0F172A' },
        paragraph: { spacing: { before: 260, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, font: 'Arial', color: '334155' },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 21, bold: true, font: 'Arial', color: '334155' },
        paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 3 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
        ] },
      { reference: 'numbers',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        ] },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              children: [
                new TextRun({ text: 'INTERVA HEALTH', bold: true, size: 18, color: '1E4976' }),
                new TextRun({ text: '\tCoE Physician Selection Rubric v4.0', size: 18, color: '64748B' }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Page ', size: 18, color: '64748B' }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '64748B' }),
                new TextRun({ text: ' \u2022 Confidential \u2022 April 2026', size: 18, color: '64748B' }),
              ],
            }),
          ],
        }),
      },
      children: content,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  const sz = fs.statSync(OUT).size;
  console.log('Wrote', OUT, '-', (sz / 1024).toFixed(1), 'KB');
});

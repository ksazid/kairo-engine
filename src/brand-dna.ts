import type { BrandBrainCandidate, EvidenceState, Provenance } from "./contracts.js";

export type BrandDnaGap = "business" | "offerings" | "audience" | "positioning" | "topics" | "boundaries" | "geography";

export interface BrandDnaFieldCandidate {
  fieldKey: string;
  value: string;
  state: EvidenceState;
  confidence: number;
  provenance: Provenance[];
}

export interface BrandDnaReadinessContribution {
  status: "ready" | "needs-enrichment";
  score: number;
  brandIntelligenceScore: number;
  evidenceCoverage: number;
  confidence: number;
  gaps: BrandDnaGap[];
}

const READINESS_FIELDS = {
  business: ["identity.description", "identity.category", "identity.sector", "identity.subsector"],
  offerings: ["identity.products-services", "identity.offers"],
  audience: ["audience.primary"],
  positioning: ["positioning.value-proposition", "positioning.differentiation", "positioning.market-position"],
  topics: ["content.core-topics", "content.preferred-topics", "content.pillars", "content.related-topics"],
  boundaries: ["boundaries.excluded-topics", "boundaries.prohibited-subjects", "boundaries.claims-to-avoid"],
  geography: ["identity.geography"],
} as const satisfies Record<BrandDnaGap, readonly string[]>;

const NON_POSITIONING = /\b(?:privacy policy|cookie policy|terms (?:of use|and conditions)|accessibility statement|all rights reserved|sign in|log in|create account)\b/i;
const POSITIONING_SIGNAL = /\b(?:help|helps|build|manage|create|grow|sell|protect|secure|design|develop|monitor|analy[sz]e|payment|commerce|platform|software|service|solution|restaurant|authentic|specialist|leading|all-in-one|faster|easier|simpler|trusted|for teams|for businesses|for developers|for creators|for restaurants)\b/i;

/**
 * Converts public website extraction into Kairo-compatible Brand-DNA field keys.
 * Website-derived fields are always `inferred`; source confidence is preserved
 * separately from owner/user confirmation semantics.
 */
export function mapWebsiteCandidateToBrandDna(candidate: BrandBrainCandidate): BrandDnaFieldCandidate[] {
  const fields: BrandDnaFieldCandidate[] = [];

  pushScalar(fields, "identity.description", candidate.description);
  pushList(fields, "identity.category", candidate.categories);
  pushList(fields, "identity.products-services", candidate.productsServices);
  pushList(fields, "audience.primary", candidate.audiences);
  pushList(fields, "content.core-topics", candidate.topics);
  pushList(fields, "identity.geography", candidate.locations);

  if (candidate.description && looksLikeValueProposition(candidate.description.value)) {
    pushScalar(fields, "positioning.value-proposition", candidate.description);
  }

  return fields;
}

/**
 * Mirrors Kairo's readiness-group weighting for an isolated website contribution.
 * It intentionally does not manufacture missing boundary, audience, positioning,
 * topic, offering or geography fields.
 */
export function evaluateWebsiteBrandDnaReadiness(
  fields: readonly BrandDnaFieldCandidate[],
  options: { geographyRequired?: boolean } = {},
): BrandDnaReadinessContribution {
  const usable = new Map<string, BrandDnaFieldCandidate>();
  for (const field of fields) {
    if (!field.value.trim() || field.state === "unknown") continue;
    const current = usable.get(field.fieldKey);
    if (!current || field.confidence > current.confidence) usable.set(field.fieldKey, field);
  }

  const gaps: BrandDnaGap[] = [];
  for (const gap of Object.keys(READINESS_FIELDS) as BrandDnaGap[]) {
    if (gap === "geography" && !options.geographyRequired) continue;
    if (!READINESS_FIELDS[gap].some((fieldKey) => usable.has(fieldKey))) gaps.push(gap);
  }

  const total = options.geographyRequired ? 7 : 6;
  const score = Math.round(((total - gaps.length) / total) * 100);
  const relevant = [...usable.values()].filter((field) => isReadinessField(field.fieldKey));
  const evidenceCoverage = relevant.length
    ? Math.round((relevant.filter((field) => field.provenance.length > 0).length / relevant.length) * 100)
    : 0;
  const confidence = relevant.length
    ? Math.round((relevant.filter((field) => field.state === "confirmed").length / relevant.length) * 100)
    : 0;
  const brandIntelligenceScore = Math.round(score * 0.6 + evidenceCoverage * 0.25 + confidence * 0.15);

  return {
    status: gaps.length ? "needs-enrichment" : "ready",
    score,
    brandIntelligenceScore,
    evidenceCoverage,
    confidence,
    gaps,
  };
}

/**
 * Website refreshes may replace prior inferred values but never owner-confirmed values.
 */
export function mergeWebsiteBrandDna(
  existing: readonly BrandDnaFieldCandidate[],
  incoming: readonly BrandDnaFieldCandidate[],
): BrandDnaFieldCandidate[] {
  const merged = new Map(existing.map((field) => [field.fieldKey, field]));
  for (const field of incoming) {
    const current = merged.get(field.fieldKey);
    if (current?.state === "confirmed") continue;
    merged.set(field.fieldKey, field);
  }
  return [...merged.values()];
}

function pushScalar(
  fields: BrandDnaFieldCandidate[],
  fieldKey: string,
  field: BrandBrainCandidate["description"],
): void {
  if (!field?.value.trim()) return;
  fields.push({
    fieldKey,
    value: field.value.trim(),
    state: "inferred",
    confidence: field.confidence,
    provenance: field.provenance,
  });
}

function pushList(
  fields: BrandDnaFieldCandidate[],
  fieldKey: string,
  field: BrandBrainCandidate["categories"],
): void {
  const values = field.value.map((value) => value.trim()).filter(Boolean);
  if (!values.length) return;
  fields.push({
    fieldKey,
    value: values.join(" | "),
    state: "inferred",
    confidence: field.confidence,
    provenance: field.provenance,
  });
}

function looksLikeValueProposition(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length >= 30 && normalized.length <= 800 && !NON_POSITIONING.test(normalized) && POSITIONING_SIGNAL.test(normalized);
}

function isReadinessField(fieldKey: string): boolean {
  return (Object.values(READINESS_FIELDS) as readonly (readonly string[])[]).some((keys) => keys.includes(fieldKey));
}

import assert from "node:assert/strict";
import test from "node:test";
import type { BrandBrainCandidate, EvidenceField, Provenance } from "../src/contracts.js";
import { evaluateWebsiteBrandDnaReadiness, mapWebsiteCandidateToBrandDna, mergeWebsiteBrandDna } from "../src/brand-dna.js";

const provenance: Provenance = {
  sourceUrl: "https://example.com/",
  pageUrl: "https://example.com/",
  retrievedAt: "2026-09-01T00:00:00.000Z",
  selector: "meta[name='description']",
  evidenceText: "Example helps restaurant teams manage ordering, payments and daily operations.",
};

function scalar(value: string, confidence = 0.9): EvidenceField<string> {
  return { value, state: "confirmed", confidence, provenance: [provenance] };
}

function list(values: string[], confidence = 0.85): EvidenceField<string[]> {
  return { value: values, state: values.length ? "confirmed" : "unknown", confidence: values.length ? confidence : 0, provenance: values.length ? [provenance] : [] };
}

function candidate(overrides: Partial<BrandBrainCandidate> = {}): BrandBrainCandidate {
  return {
    description: scalar("Example helps restaurant teams manage ordering, payments and daily operations."),
    categories: list(["Restaurant software"]),
    productsServices: list(["Ordering", "Payments"]),
    audiences: list(["Restaurant teams"]),
    locations: list(["Malta"]),
    topics: list(["Restaurant operations", "Payments"]),
    contactEmails: list([]),
    socialLinks: list([]),
    developerLinks: list([]),
    websiteLinks: list([]),
    ...overrides,
  };
}

test("maps website facts to canonical Brand-DNA field keys", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate());
  const keys = new Set(fields.map((field) => field.fieldKey));

  assert(keys.has("identity.description"));
  assert(keys.has("identity.category"));
  assert(keys.has("identity.products-services"));
  assert(keys.has("audience.primary"));
  assert(keys.has("positioning.value-proposition"));
  assert(keys.has("content.core-topics"));
  assert(keys.has("identity.geography"));
});

test("website-derived Brand-DNA fields are inferred even when source evidence is high-confidence", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate());
  assert(fields.length > 0);
  assert(fields.every((field) => field.state === "inferred"));
  assert(fields.every((field) => field.provenance.length > 0));
});

test("strong website remains needs-enrichment when boundaries are not explicitly supported", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate());
  const readiness = evaluateWebsiteBrandDnaReadiness(fields, { geographyRequired: true });

  assert.equal(readiness.status, "needs-enrichment");
  assert.deepEqual(readiness.gaps, ["boundaries"]);
  assert.equal(readiness.score, 86);
  assert.equal(readiness.evidenceCoverage, 100);
  assert.equal(readiness.confidence, 0);
  assert.equal(readiness.brandIntelligenceScore, 77);
});

test("geography is optional for location-independent businesses", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate({ locations: list([]) }));
  const readiness = evaluateWebsiteBrandDnaReadiness(fields, { geographyRequired: false });
  assert(!readiness.gaps.includes("geography"));
});

test("geography remains a visible gap for location-dependent businesses", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate({ locations: list([]) }));
  const readiness = evaluateWebsiteBrandDnaReadiness(fields, { geographyRequired: true });
  assert(readiness.gaps.includes("geography"));
});

test("generic policy copy is not promoted into positioning", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate({
    description: scalar("Privacy Policy and cookie policy information for visitors to this website."),
  }));
  assert(!fields.some((field) => field.fieldKey === "positioning.value-proposition"));
});

test("missing audience remains a readiness gap instead of being invented", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate({ audiences: list([]) }));
  const readiness = evaluateWebsiteBrandDnaReadiness(fields);
  assert(readiness.gaps.includes("audience"));
  assert(!fields.some((field) => field.fieldKey === "audience.primary"));
});

test("missing offerings remain a readiness gap instead of being invented", () => {
  const fields = mapWebsiteCandidateToBrandDna(candidate({ productsServices: list([]) }));
  const readiness = evaluateWebsiteBrandDnaReadiness(fields);
  assert(readiness.gaps.includes("offerings"));
});

test("website refresh cannot overwrite an owner-confirmed Brand-DNA field", () => {
  const existing = mapWebsiteCandidateToBrandDna(candidate());
  const confirmed = { ...existing.find((field) => field.fieldKey === "identity.description")!, value: "Owner confirmed description", state: "confirmed" as const };
  const prior = existing.map((field) => field.fieldKey === confirmed.fieldKey ? confirmed : field);

  const refreshed = mapWebsiteCandidateToBrandDna(candidate({
    description: scalar("Example now describes a different inferred website message for restaurant teams."),
  }));
  const merged = mergeWebsiteBrandDna(prior, refreshed);

  assert.equal(merged.find((field) => field.fieldKey === "identity.description")?.value, "Owner confirmed description");
  assert.equal(merged.find((field) => field.fieldKey === "identity.description")?.state, "confirmed");
});

test("website refresh replaces a prior inferred value", () => {
  const prior = mapWebsiteCandidateToBrandDna(candidate());
  const refreshed = mapWebsiteCandidateToBrandDna(candidate({
    description: scalar("Example helps restaurant operators simplify ordering, payments and daily operations."),
  }));
  const merged = mergeWebsiteBrandDna(prior, refreshed);

  assert.equal(
    merged.find((field) => field.fieldKey === "identity.description")?.value,
    "Example helps restaurant operators simplify ordering, payments and daily operations.",
  );
});

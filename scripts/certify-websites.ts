import { writeFile } from "node:fs/promises";
import { collectWebsiteEvidence, extractBrandBrain } from "../src/website.js";
import { evaluateWebsiteBrandDnaReadiness, mapWebsiteCandidateToBrandDna } from "../src/brand-dna.js";
import type { CertificationResult } from "../src/contracts.js";

type Case = {
  name: string;
  kind: string;
  url: string;
  expectedBrand: RegExp;
  expectedText: RegExp;
  expectedOfferings?: RegExp[];
  expectedLocation?: RegExp;
  forbiddenContact?: RegExp;
  geographyRequired?: boolean;
  positioningRequired?: boolean;
};

const cases: Case[] = [
  { name: "Stripe", kind: "large-saas", url: "https://stripe.com", expectedBrand: /stripe/i, expectedText: /payment|financial|revenue/i, expectedOfferings: [/payment/i] },
  { name: "Linear", kind: "blocked-js-saas", url: "https://linear.app", expectedBrand: /linear/i, expectedText: /product|development|issue|project/i, expectedOfferings: [/issue|project|cycle|roadmap/i] },
  { name: "PostHog", kind: "content-heavy-saas", url: "https://posthog.com", expectedBrand: /posthog/i, expectedText: /product|analytics|feature/i, expectedOfferings: [/analytics|replay|feature flag/i] },
  { name: "Cloudflare", kind: "multi-product-platform", url: "https://www.cloudflare.com", expectedBrand: /cloudflare/i, expectedText: /network|security|cloud|developer/i, expectedOfferings: [/worker|zero trust|cdn|application/i] },
  { name: "Sentry", kind: "developer-tool", url: "https://sentry.io", expectedBrand: /sentry/i, expectedText: /monitor|error|performance|developer/i, expectedOfferings: [/error|replay|tracing|monitor/i], forbiddenContact: /ingest|examplepublickey/i },
  { name: "Shopify", kind: "commerce-platform", url: "https://www.shopify.com", expectedBrand: /shopify/i, expectedText: /commerce|sell|store/i, expectedOfferings: [/payment|store|commerce|point of sale|pos/i] },
  { name: "Notion", kind: "js-heavy-workspace", url: "https://www.notion.com", expectedBrand: /^notion(?:\s|$)/i, expectedText: /workspace|knowledge|team|work/i, expectedOfferings: [/ai|docs|project|wiki/i] },
  { name: "Figma", kind: "design-platform", url: "https://www.figma.com", expectedBrand: /figma/i, expectedText: /design|collaborat|canvas/i, expectedOfferings: [/design|figjam|dev mode/i] },
  { name: "DIGICO", kind: "local-b2b", url: "https://www.digico.com.mt", expectedBrand: /digico/i, expectedText: /software|saas|erp|payroll/i, expectedOfferings: [/erp|payroll|reservation/i], expectedLocation: /marsascala|malta/i, geographyRequired: true },
  { name: "Ta Pawla", kind: "local-restaurant", url: "https://tapawlarestaurant.com", expectedBrand: /pawla/i, expectedText: /restaurant|maltese|mediterranean/i, expectedOfferings: [/fish|meat|pasta|pizza|maltese/i], expectedLocation: /saint paul|st\.? paul|tourists street|malta/i, geographyRequired: true },
  { name: "Square Malta", kind: "local-multi-location-restaurant", url: "https://square.mt", expectedBrand: /square/i, expectedText: /restaurant|mediterranean|dining/i, expectedOfferings: [/breakfast|burger|pizza|pasta/i], expectedLocation: /qormi|mosta|pavi|pama/i, geographyRequired: true },
  { name: "GitHub Docs", kind: "documentation-control", url: "https://docs.github.com", expectedBrand: /github/i, expectedText: /git|github|repository|documentation/i, forbiddenContact: /ingest|examplepublickey/i, positioningRequired: false },
];

const NOISE = /^(?:skip to|read the docs|create now|english|español|deutsch|français|italiano|support|learn|more|free|standard|custom|current deals)$/i;
type Output = CertificationResult & {
  name: string;
  kind: string;
  assertions: Record<string, boolean>;
  score: number;
  extracted: unknown;
  brandDna?: {
    fields: Array<{ fieldKey: string; value: string; state: string; confidence: number; provenanceCount: number }>;
    readiness: ReturnType<typeof evaluateWebsiteBrandDnaReadiness>;
  };
};
const outputs: Output[] = [];

for (const testCase of cases) {
  const started = Date.now();
  try {
    const evidence = await collectWebsiteEvidence(testCase.url);
    const candidate = extractBrandBrain(evidence);
    const dnaFields = mapWebsiteCandidateToBrandDna(candidate);
    const readiness = evaluateWebsiteBrandDnaReadiness(dnaFields, { geographyRequired: Boolean(testCase.geographyRequired) });
    const totalText = evidence.pages.map((page) => `${page.title ?? ""} ${page.description ?? ""} ${page.text}`).join(" ");
    const brand = candidate.brandName?.value ?? "";
    const offerings = candidate.productsServices.value.join(" | ");
    const locations = candidate.locations.value.join(" | ");
    const contacts = candidate.contactEmails.value.join(" | ");
    const keyProvenance = [candidate.brandName, candidate.description, candidate.productsServices]
      .filter((field): field is NonNullable<typeof field> => Boolean(field))
      .flatMap((field) => field.provenance);
    const offeringCoverage = !testCase.expectedOfferings?.length || testCase.expectedOfferings.every((pattern) => pattern.test(offerings));
    const locationCoverage = !testCase.expectedLocation || testCase.expectedLocation.test(locations);
    const contactPrecision = !testCase.forbiddenContact || !testCase.forbiddenContact.test(contacts);
    const noiseFree = candidate.productsServices.value.every((value) => !NOISE.test(value.trim())) && candidate.topics.value.every((value) => !NOISE.test(value.trim()));
    const provenanceExact = keyProvenance.length > 0 && keyProvenance.every((item) => Boolean(item.pageUrl && item.selector && item.evidenceText));
    const dnaProvenanceExact = dnaFields.length > 0 && dnaFields.every((field) => field.provenance.length > 0 && field.provenance.every((item) => Boolean(item.pageUrl && item.evidenceText)));
    const dnaInferredOnly = dnaFields.length > 0 && dnaFields.every((field) => field.state === "inferred");
    const dnaPositioning = testCase.positioningRequired === false || dnaFields.some((field) => field.fieldKey === "positioning.value-proposition");
    const dnaGeography = !testCase.geographyRequired || dnaFields.some((field) => field.fieldKey === "identity.geography");
    const boundaryFields = dnaFields.filter((field) => field.fieldKey.startsWith("boundaries."));
    const dnaBoundaryTruthful = boundaryFields.length > 0 || readiness.gaps.includes("boundaries");

    const assertions: Record<string, boolean> = {
      fetch: evidence.pages.length > 0,
      brand: testCase.expectedBrand.test(brand),
      positioningEvidence: testCase.expectedText.test(totalText),
      description: Boolean(candidate.description?.value && candidate.description.value.length >= 20),
      provenanceExact,
      meaningfulText: evidence.pages.reduce((sum, page) => sum + page.text.length, 0) >= 500,
      offeringCoverage,
      locationCoverage,
      contactPrecision,
      noiseFree,
      crawlerHygiene: evidence.warnings.length <= 2,
      dnaProvenanceExact,
      dnaInferredOnly,
      dnaPositioning,
      dnaGeography,
      dnaBoundaryTruthful,
    };
    const score = Math.round(Object.values(assertions).filter(Boolean).length / Object.keys(assertions).length * 100);
    outputs.push({
      name: testCase.name,
      kind: testCase.kind,
      inputUrl: testCase.url,
      canonicalUrl: evidence.canonicalSourceUrl,
      fetchOk: evidence.pages.length > 0,
      pagesFetched: evidence.pages.length,
      warnings: evidence.warnings,
      candidate,
      metrics: {
        elapsedMs: Date.now() - started,
        totalTextChars: evidence.pages.reduce((sum, page) => sum + page.text.length, 0),
        totalLinks: evidence.pages.reduce((sum, page) => sum + page.links.length, 0),
        totalJsonLd: evidence.pages.reduce((sum, page) => sum + page.jsonLd.length, 0),
        browserPages: evidence.pages.filter((page) => page.retrievalMode === "browser").length,
      },
      assertions,
      score,
      brandDna: {
        fields: dnaFields.map((field) => ({
          fieldKey: field.fieldKey,
          value: field.value,
          state: field.state,
          confidence: field.confidence,
          provenanceCount: field.provenance.length,
        })),
        readiness,
      },
      extracted: {
        brandName: candidate.brandName?.value,
        description: candidate.description?.value,
        categories: candidate.categories.value,
        productsServices: candidate.productsServices.value,
        audiences: candidate.audiences.value,
        locations: candidate.locations.value,
        topics: candidate.topics.value.slice(0, 15),
        contactEmails: candidate.contactEmails.value,
        socialLinks: candidate.socialLinks.value,
        developerLinks: candidate.developerLinks.value,
        browserPages: evidence.pages.filter((page) => page.retrievalMode === "browser").map((page) => page.url),
      },
    });
    const failed = Object.entries(assertions).filter(([, pass]) => !pass).map(([name]) => name);
    console.log(`${testCase.name.padEnd(16)} ${String(score).padStart(3)}% pages=${evidence.pages.length} browser=${evidence.pages.filter((page) => page.retrievalMode === "browser").length} BI=${String(readiness.brandIntelligenceScore).padStart(3)} DNA=${readiness.score}% gaps=${readiness.gaps.join("|") || "none"} brand=${JSON.stringify(brand)} warnings=${evidence.warnings.length}${failed.length ? ` failed=${failed.join(",")}` : ""}`);
  } catch (error) {
    outputs.push({
      name: testCase.name,
      kind: testCase.kind,
      inputUrl: testCase.url,
      fetchOk: false,
      pagesFetched: 0,
      warnings: [error instanceof Error ? error.message : String(error)],
      metrics: { elapsedMs: Date.now() - started, totalTextChars: 0, totalLinks: 0, totalJsonLd: 0, browserPages: 0 },
      assertions: { fetch: false, brand: false, positioningEvidence: false, description: false, provenanceExact: false, meaningfulText: false, offeringCoverage: false, locationCoverage: false, contactPrecision: false, noiseFree: false, crawlerHygiene: false, dnaProvenanceExact: false, dnaInferredOnly: false, dnaPositioning: false, dnaGeography: false, dnaBoundaryTruthful: false },
      score: 0,
      extracted: {},
    });
    console.log(`${testCase.name.padEnd(16)}   0% fatal=${error instanceof Error ? error.message : String(error)}`);
  }
}

const average = Math.round(outputs.reduce((sum, item) => sum + item.score, 0) / outputs.length);
const fetchPass = outputs.filter((item) => item.fetchOk).length;
const strongPass = outputs.filter((item) => item.score >= 90).length;
const allExpectedFieldsPass = outputs.every((item) => item.assertions.brand && item.assertions.offeringCoverage && item.assertions.locationCoverage && item.assertions.contactPrecision && item.assertions.provenanceExact);
const allBrandDnaSemanticsPass = outputs.every((item) => item.assertions.dnaProvenanceExact && item.assertions.dnaInferredOnly && item.assertions.dnaPositioning && item.assertions.dnaGeography && item.assertions.dnaBoundaryTruthful);
const averageBrandIntelligenceScore = Math.round(outputs.reduce((sum, item) => sum + (item.brandDna?.readiness.brandIntelligenceScore ?? 0), 0) / outputs.length);
const averageBrandDnaCoverage = Math.round(outputs.reduce((sum, item) => sum + (item.brandDna?.readiness.score ?? 0), 0) / outputs.length);
const gapCounts = outputs.reduce<Record<string, number>>((counts, item) => {
  for (const gap of item.brandDna?.readiness.gaps ?? []) counts[gap] = (counts[gap] ?? 0) + 1;
  return counts;
}, {});
const summary = {
  generatedAt: new Date().toISOString(),
  schema: "flow-1a-certification-v3-bi-dna",
  cases: outputs.length,
  fetchPass,
  strongPass,
  averageScore: average,
  allExpectedFieldsPass,
  allBrandDnaSemanticsPass,
  brandDna: {
    averageBrandIntelligenceScore,
    averageCoverageScore: averageBrandDnaCoverage,
    gapCounts,
  },
  certificationPass: fetchPass === outputs.length && strongPass === outputs.length && average >= 95 && allExpectedFieldsPass && allBrandDnaSemanticsPass,
  results: outputs,
};
await writeFile("certification-results.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\nSUMMARY cases=${outputs.length} fetched=${fetchPass}/${outputs.length} >=90=${strongPass}/${outputs.length} average=${average}% fields=${allExpectedFieldsPass ? "PASS" : "FAIL"} dna=${allBrandDnaSemanticsPass ? "PASS" : "FAIL"} avgBI=${averageBrandIntelligenceScore} avgDNA=${averageBrandDnaCoverage}% gaps=${JSON.stringify(gapCounts)} certification=${summary.certificationPass ? "PASS" : "FAIL"}`);
if (!summary.certificationPass) process.exitCode = 1;

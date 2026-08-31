import { writeFile } from "node:fs/promises";
import { collectWebsiteEvidence, extractBrandBrain } from "../src/website.js";
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
  { name: "DIGICO", kind: "local-b2b", url: "https://www.digico.com.mt", expectedBrand: /digico/i, expectedText: /software|saas|erp|payroll/i, expectedOfferings: [/erp|payroll|reservation/i], expectedLocation: /marsascala|malta/i },
  { name: "Ta Pawla", kind: "local-restaurant", url: "https://tapawlarestaurant.com", expectedBrand: /pawla/i, expectedText: /restaurant|maltese|mediterranean/i, expectedOfferings: [/fish|meat|pasta|pizza|maltese/i], expectedLocation: /saint paul|st\.? paul|tourists street|malta/i },
  { name: "Square Malta", kind: "local-multi-location-restaurant", url: "https://square.mt", expectedBrand: /square/i, expectedText: /restaurant|mediterranean|dining/i, expectedOfferings: [/breakfast|burger|pizza|pasta/i], expectedLocation: /qormi|mosta|pavi|pama/i },
  { name: "GitHub Docs", kind: "documentation-control", url: "https://docs.github.com", expectedBrand: /github/i, expectedText: /git|github|repository|documentation/i, forbiddenContact: /ingest|examplepublickey/i },
];

const NOISE = /^(?:skip to|read the docs|create now|english|español|deutsch|français|italiano|support|learn|more|free|standard|custom|current deals)$/i;
type Output = CertificationResult & { name: string; kind: string; assertions: Record<string, boolean>; score: number; extracted: unknown };
const outputs: Output[] = [];

for (const testCase of cases) {
  const started = Date.now();
  try {
    const evidence = await collectWebsiteEvidence(testCase.url);
    const candidate = extractBrandBrain(evidence);
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

    const assertions: Record<string, boolean> = {
      fetch: evidence.pages.length > 0,
      brand: testCase.expectedBrand.test(brand),
      positioning: testCase.expectedText.test(totalText),
      description: Boolean(candidate.description?.value && candidate.description.value.length >= 20),
      provenanceExact,
      meaningfulText: evidence.pages.reduce((sum, page) => sum + page.text.length, 0) >= 500,
      offeringCoverage,
      locationCoverage,
      contactPrecision,
      noiseFree,
      crawlerHygiene: evidence.warnings.length <= 2,
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
    console.log(`${testCase.name.padEnd(16)} ${String(score).padStart(3)}% pages=${evidence.pages.length} browser=${evidence.pages.filter((page) => page.retrievalMode === "browser").length} brand=${JSON.stringify(brand)} warnings=${evidence.warnings.length}${failed.length ? ` failed=${failed.join(",")}` : ""}`);
  } catch (error) {
    outputs.push({
      name: testCase.name,
      kind: testCase.kind,
      inputUrl: testCase.url,
      fetchOk: false,
      pagesFetched: 0,
      warnings: [error instanceof Error ? error.message : String(error)],
      metrics: { elapsedMs: Date.now() - started, totalTextChars: 0, totalLinks: 0, totalJsonLd: 0, browserPages: 0 },
      assertions: { fetch: false, brand: false, positioning: false, description: false, provenanceExact: false, meaningfulText: false, offeringCoverage: false, locationCoverage: false, contactPrecision: false, noiseFree: false, crawlerHygiene: false },
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
const summary = {
  generatedAt: new Date().toISOString(),
  schema: "flow-1a-certification-v2",
  cases: outputs.length,
  fetchPass,
  strongPass,
  averageScore: average,
  allExpectedFieldsPass,
  certificationPass: fetchPass === outputs.length && strongPass === outputs.length && average >= 95 && allExpectedFieldsPass,
  results: outputs,
};
await writeFile("certification-results.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\nSUMMARY cases=${outputs.length} fetched=${fetchPass}/${outputs.length} >=90=${strongPass}/${outputs.length} average=${average}% fields=${allExpectedFieldsPass ? "PASS" : "FAIL"} certification=${summary.certificationPass ? "PASS" : "FAIL"}`);
if (!summary.certificationPass) process.exitCode = 1;

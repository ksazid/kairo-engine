import { writeFile } from "node:fs/promises";
import { collectWebsiteEvidence, extractBrandBrain } from "../src/website.js";
import type { CertificationResult } from "../src/contracts.js";

type Case = {
  name: string;
  kind: string;
  url: string;
  expectedBrand: RegExp;
  expectedText: RegExp;
};

const cases: Case[] = [
  { name: "Stripe", kind: "large-saas", url: "https://stripe.com", expectedBrand: /stripe/i, expectedText: /payment|financial|revenue/i },
  { name: "Linear", kind: "js-heavy-saas", url: "https://linear.app", expectedBrand: /linear/i, expectedText: /product|development|issue/i },
  { name: "PostHog", kind: "content-heavy-saas", url: "https://posthog.com", expectedBrand: /posthog/i, expectedText: /product|analytics|feature/i },
  { name: "Cloudflare", kind: "multi-product-platform", url: "https://www.cloudflare.com", expectedBrand: /cloudflare/i, expectedText: /network|security|cloud|developer/i },
  { name: "Sentry", kind: "developer-tool", url: "https://sentry.io", expectedBrand: /sentry/i, expectedText: /monitor|error|performance|developer/i },
  { name: "Shopify", kind: "commerce-platform", url: "https://www.shopify.com", expectedBrand: /shopify/i, expectedText: /commerce|sell|store/i },
  { name: "Notion", kind: "js-heavy-workspace", url: "https://www.notion.com", expectedBrand: /notion/i, expectedText: /workspace|knowledge|team|work/i },
  { name: "Figma", kind: "design-platform", url: "https://www.figma.com", expectedBrand: /figma/i, expectedText: /design|collaborat|canvas/i },
  { name: "DIGICO", kind: "local-b2b", url: "https://www.digico.com.mt", expectedBrand: /digico/i, expectedText: /software|saas|erp|payroll/i },
  { name: "Ta Pawla", kind: "local-restaurant", url: "https://tapawlarestaurant.com", expectedBrand: /pawla/i, expectedText: /restaurant|maltese|mediterranean/i },
  { name: "Square Malta", kind: "local-multi-location-restaurant", url: "https://square.mt", expectedBrand: /square/i, expectedText: /restaurant|mediterranean|dining/i },
  { name: "GitHub Docs", kind: "documentation-negative-control", url: "https://docs.github.com", expectedBrand: /github/i, expectedText: /git|github|repository|documentation/i },
];

const outputs: Array<CertificationResult & { name: string; kind: string; assertions: Record<string, boolean>; score: number; extracted: unknown }> = [];

for (const testCase of cases) {
  const started = Date.now();
  try {
    const evidence = await collectWebsiteEvidence(testCase.url);
    const candidate = extractBrandBrain(evidence);
    const totalText = evidence.pages.map((p) => `${p.title ?? ""} ${p.description ?? ""} ${p.text}`).join(" ");
    const brand = candidate.brandName?.value ?? "";
    const assertions = {
      fetch: evidence.pages.length > 0,
      brand: testCase.expectedBrand.test(brand),
      positioning: testCase.expectedText.test(totalText),
      description: Boolean(candidate.description?.value && candidate.description.value.length >= 20),
      provenance: Boolean(candidate.brandName?.provenance.length || candidate.description?.provenance.length),
      meaningfulText: evidence.pages.reduce((n, p) => n + p.text.length, 0) >= 500,
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
        totalTextChars: evidence.pages.reduce((n, p) => n + p.text.length, 0),
        totalLinks: evidence.pages.reduce((n, p) => n + p.links.length, 0),
        totalJsonLd: evidence.pages.reduce((n, p) => n + p.jsonLd.length, 0),
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
        topics: candidate.topics.value.slice(0, 12),
        contactEmails: candidate.contactEmails.value,
        socialLinks: candidate.socialLinks.value,
      },
    });
    console.log(`${testCase.name.padEnd(16)} ${String(score).padStart(3)}% pages=${evidence.pages.length} brand=${JSON.stringify(brand)} warnings=${evidence.warnings.length}`);
  } catch (error) {
    outputs.push({
      name: testCase.name,
      kind: testCase.kind,
      inputUrl: testCase.url,
      fetchOk: false,
      pagesFetched: 0,
      warnings: [error instanceof Error ? error.message : String(error)],
      metrics: { elapsedMs: Date.now() - started, totalTextChars: 0, totalLinks: 0, totalJsonLd: 0 },
      assertions: { fetch: false, brand: false, positioning: false, description: false, provenance: false, meaningfulText: false },
      score: 0,
      extracted: {},
    });
    console.log(`${testCase.name.padEnd(16)}   0% fatal=${error instanceof Error ? error.message : String(error)}`);
  }
}

const average = Math.round(outputs.reduce((sum, item) => sum + item.score, 0) / outputs.length);
const fetchPass = outputs.filter((item) => item.fetchOk).length;
const highPass = outputs.filter((item) => item.score >= 80).length;
const summary = {
  generatedAt: new Date().toISOString(),
  cases: outputs.length,
  fetchPass,
  highPass,
  averageScore: average,
  certificationPass: fetchPass === outputs.length && highPass >= Math.ceil(outputs.length * 0.8) && average >= 85,
  results: outputs,
};
await writeFile("certification-results.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\nSUMMARY cases=${outputs.length} fetched=${fetchPass}/${outputs.length} >=80=${highPass}/${outputs.length} average=${average}% certification=${summary.certificationPass ? "PASS" : "FAIL"}`);
if (!summary.certificationPass) process.exitCode = 1;

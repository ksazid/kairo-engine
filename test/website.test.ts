import assert from "node:assert/strict";
import test from "node:test";
import { extractBrandBrain, parsePage } from "../src/website.js";
import type { WebsiteEvidence } from "../src/contracts.js";

test("extracts grounded organization, product, audience, address and links", () => {
  const html = `<!doctype html><html><head>
    <title>Acme Cloud | Secure analytics</title>
    <meta name="description" content="Acme Cloud helps retail teams understand customer behavior.">
    <script type="application/ld+json">{
      "@context":"https://schema.org","@type":"Organization","name":"Acme Cloud",
      "description":"Analytics for modern retail teams.",
      "address":{"@type":"PostalAddress","addressLocality":"Valletta","addressCountry":"Malta"},
      "audience":{"@type":"Audience","audienceType":"Retail teams"}
    }</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Acme Insights","category":"Analytics"}</script>
  </head><body>
    <h1>Understand every customer journey</h1><h2>Retail analytics</h2>
    <p>Acme Cloud gives commerce teams a complete view of their customer behavior and conversion funnel.</p>
    <a href="/products/insights">Acme Insights</a>
    <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
    <a href="https://github.com/acme/acme-sdk">SDK</a>
    <a href="mailto:hello@acme.test">Email</a>
    <p>Contact hello@acme.test for product information and demonstrations.</p>
  </body></html>`;
  const page = parsePage("https://acme.test/", 200, html);
  const evidence: WebsiteEvidence = { sourceUrl: "https://acme.test", canonicalSourceUrl: "https://acme.test/", pages: [page], warnings: [] };
  const result = extractBrandBrain(evidence);
  assert.equal(result.brandName?.value, "Acme Cloud");
  assert.equal(result.description?.value, "Analytics for modern retail teams.");
  assert.ok(result.productsServices.value.includes("Acme Insights"));
  assert.ok(result.audiences.value.includes("Retail teams"));
  assert.ok(result.locations.value.some((value) => value.includes("Valletta") && value.includes("Malta")));
  assert.deepEqual(result.contactEmails.value, ["hello@acme.test"]);
  assert.ok(result.socialLinks.value.includes("https://www.linkedin.com/company/acme"));
  assert.ok(result.developerLinks.value.includes("https://github.com/acme/acme-sdk"));
  assert.ok(result.brandName?.provenance[0]?.selector);
  assert.equal(result.brandName?.provenance[0]?.evidenceText, "Acme Cloud");
});

test("uses site identity instead of a marketing tagline", () => {
  const page = parsePage("https://www.notion.test/", 200, `<html><head>
    <title>The AI workspace that works for you. | Notion</title>
    <meta property="og:site_name" content="Notion">
    <meta name="description" content="A connected workspace for teams to write, plan, and organize work.">
  </head><body><h1>The AI workspace that works for you.</h1><p>A connected workspace for teams to write, plan, and organize work together.</p></body></html>`);
  const result = extractBrandBrain({ sourceUrl: "https://www.notion.test", canonicalSourceUrl: "https://www.notion.test/", pages: [page], warnings: [] });
  assert.equal(result.brandName?.value, "Notion");
  assert.equal(result.brandName?.provenance[0]?.selector, "meta[property='og:site_name'],meta[name='application-name']");
});

test("does not treat telemetry DSNs or arbitrary body emails as contacts", () => {
  const page = parsePage("https://sentry-like.test/", 200, `<html><head><title>Sentry Like</title><meta name="description" content="Developer monitoring for production applications."></head><body>
    <h1>Error monitoring</h1>
    <p>Configure https://examplepublickey@o0.ingest.sentry.io/0 in your SDK to send telemetry events.</p>
    <p>Copyright questions can be sent to copyright@example.org in this documentation example.</p>
    <a href="mailto:support@sentry-like.test">Contact support</a>
  </body></html>`);
  const result = extractBrandBrain({ sourceUrl: "https://sentry-like.test", canonicalSourceUrl: "https://sentry-like.test/", pages: [page], warnings: [] });
  assert.deepEqual(result.contactEmails.value, ["support@sentry-like.test"]);
});

test("does not invent structured facts when evidence is absent", () => {
  const page = parsePage("https://minimal.test/", 200, "<html><head><title>Minimal</title></head><body><h1>Hello</h1><p>This is a deliberately sparse public page with no structured business facts.</p></body></html>");
  const result = extractBrandBrain({ sourceUrl: "https://minimal.test", canonicalSourceUrl: "https://minimal.test/", pages: [page], warnings: [] });
  assert.equal(result.brandName?.value, "Minimal");
  assert.equal(result.categories.state, "unknown");
  assert.deepEqual(result.categories.value, []);
  assert.equal(result.audiences.state, "unknown");
  assert.deepEqual(result.audiences.value, []);
  assert.equal(result.locations.state, "unknown");
  assert.deepEqual(result.locations.value, []);
});

test("removes scripts, records mailto separately, and resolves relative links", () => {
  const page = parsePage("https://example.test/path", 200, "<html><body><script>secret()</script><h1>Heading</h1><p>A paragraph long enough to remain in normalized evidence output.</p><a href='/about'>About us</a><a href='mailto:hello@example.test'>Email</a></body></html>");
  assert.ok(!page.text.includes("secret()"));
  assert.equal(page.links[0]?.href, "https://example.test/about");
  assert.deepEqual(page.mailtoEmails, ["hello@example.test"]);
});

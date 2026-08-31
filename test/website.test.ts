import assert from "node:assert/strict";
import test from "node:test";
import { extractBrandBrain, parsePage } from "../src/website.js";
import type { WebsiteEvidence } from "../src/contracts.js";

function evidence(url: string, html: string): WebsiteEvidence {
  const page = parsePage(url, 200, html);
  return { sourceUrl: url, canonicalSourceUrl: url, pages: [page], warnings: [] };
}

test("extracts grounded organization, product, audience, address and links", () => {
  const result = extractBrandBrain(evidence("https://acme.test/", `<!doctype html><html><head>
    <title>Acme Cloud | Secure analytics</title>
    <meta name="description" content="Acme Cloud helps retail teams understand customer behavior.">
    <script type="application/ld+json">{
      "@context":"https://schema.org","@type":"Organization","name":"Acme Cloud","url":"https://acme.test/",
      "description":"Analytics for modern retail teams.",
      "address":{"@type":"PostalAddress","addressLocality":"Valletta","addressCountry":"Malta"},
      "audience":{"@type":"Audience","audienceType":"Retail teams"}
    }</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Acme Insights","category":"Analytics"}</script>
  </head><body><main>
    <h1>Understand every customer journey</h1><h2>Retail analytics</h2>
    <p>Acme Cloud gives commerce teams a complete view of their customer behavior and conversion funnel.</p>
    <a href="/products/insights">Acme Insights</a>
    <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
    <a href="https://github.com/acme/acme-sdk">SDK</a>
    <a href="mailto:hello@acme.test">Email</a>
  </main></body></html>`));
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

test("site identity outranks an unrelated embedded video provider organization", () => {
  const result = extractBrandBrain(evidence("https://square.test/", `<html><head>
    <title>Square Restaurants Malta</title><meta property="og:site_name" content="Square">
    <meta name="description" content="Square operates Mediterranean restaurants in Malta.">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Sunday In Scotland on Vimeo","url":"https://vimeo.com/sundayinscotland"}</script>
  </head><body><main><h1>Square</h1><p>Restaurants in Qormi and Mosta serving Mediterranean food all day.</p></main></body></html>`));
  assert.equal(result.brandName?.value, "Square");
  assert.notEqual(result.brandName?.value, "Sunday In Scotland on Vimeo");
});

test("uses site identity instead of a marketing tagline", () => {
  const result = extractBrandBrain(evidence("https://www.notion.test/", `<html><head>
    <title>The AI workspace that works for you. | Notion</title>
    <meta property="og:site_name" content="Notion">
    <meta name="description" content="A connected workspace for teams to write, plan, and organize work.">
  </head><body><main><h1>The AI workspace that works for you.</h1><p>A connected workspace for teams to write, plan, and organize work together.</p></main></body></html>`));
  assert.equal(result.brandName?.value, "Notion");
  assert.equal(result.brandName?.provenance[0]?.selector, "meta[property='og:site_name'],meta[name='application-name']");
});

test("extracts products nested in offer catalogs and item lists", () => {
  const result = extractBrandBrain(evidence("https://catalog.test/", `<html><head><title>Catalog</title><meta name="description" content="A catalog of business software services.">
    <script type="application/ld+json">{
      "@context":"https://schema.org","@type":"Organization","name":"Catalog","url":"https://catalog.test/",
      "hasOfferCatalog":{"@type":"OfferCatalog","name":"Business Software","itemListElement":[
        {"@type":"Service","name":"Payroll Automation"},
        {"@type":"Service","name":"ERP Management"}
      ]}
    }</script>
  </head><body><main><h1>Business Software</h1><p>Modern tools for finance and operations teams.</p></main></body></html>`));
  assert.ok(result.productsServices.value.includes("Payroll Automation"));
  assert.ok(result.productsServices.value.includes("ERP Management"));
});

test("extracts microdata address components as grounded location evidence", () => {
  const result = extractBrandBrain(evidence("https://local.test/contact", `<html><head><title>Local Co</title><meta name="description" content="Local services company in Malta."></head><body>
    <main><h1>Contact Local Co</h1><div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
      <span itemprop="streetAddress">10 Triq il-Port</span><span itemprop="addressLocality">Marsascala</span>
      <span itemprop="postalCode">MSK 1000</span><span itemprop="addressCountry">Malta</span>
    </div><p>Visit our Malta office for product demonstrations and customer support.</p></main>
  </body></html>`));
  assert.ok(result.locations.value.some((value) => /marsascala/i.test(value) && /malta/i.test(value)));
  assert.ok(result.locations.provenance.some((item) => item.selector?.includes("address")));
});

test("does not promote navigation, footer or language labels into topics", () => {
  const result = extractBrandBrain(evidence("https://clean.test/", `<html><head><title>Clean</title><meta name="description" content="Analytics software for product teams."></head><body>
    <header><h2>Sign in</h2><nav><h3>English</h3><a href="/pricing">Pricing</a></nav></header>
    <main><h1>Product analytics for modern teams</h1><h2>Session Replay</h2><p>Understand users and improve your product with behavioral analytics.</p></main>
    <footer><h2>Support</h2><h3>Deutsch</h3></footer>
  </body></html>`));
  assert.ok(result.topics.value.includes("Product analytics for modern teams"));
  assert.ok(result.topics.value.includes("Session Replay"));
  assert.ok(!result.topics.value.some((value) => /sign in|english|support|deutsch/i.test(value)));
});

test("does not treat telemetry DSNs or arbitrary body emails as contacts", () => {
  const result = extractBrandBrain(evidence("https://sentry-like.test/", `<html><head><title>Sentry Like</title><meta name="description" content="Developer monitoring for production applications."></head><body><main>
    <h1>Error monitoring</h1>
    <p>Configure https://examplepublickey@o0.ingest.sentry.io/0 in your SDK to send telemetry events.</p>
    <p>Copyright questions can be sent to copyright@example.org in this documentation example.</p>
    <a href="mailto:support@sentry-like.test">Contact support</a>
  </main></body></html>`));
  assert.deepEqual(result.contactEmails.value, ["support@sentry-like.test"]);
});

test("does not invent structured facts when evidence is absent", () => {
  const result = extractBrandBrain(evidence("https://minimal.test/", "<html><head><title>Minimal</title></head><body><main><h1>Hello</h1><p>This is a deliberately sparse public page with no structured business facts.</p></main></body></html>"));
  assert.equal(result.brandName?.value, "Minimal");
  assert.equal(result.categories.state, "unknown");
  assert.deepEqual(result.categories.value, []);
  assert.equal(result.audiences.state, "unknown");
  assert.deepEqual(result.audiences.value, []);
  assert.equal(result.locations.state, "unknown");
  assert.deepEqual(result.locations.value, []);
});

test("removes scripts, records mailto separately, and resolves relative links", () => {
  const page = parsePage("https://example.test/path", 200, "<html><body><main><script>secret()</script><h1>Heading</h1><p>A paragraph long enough to remain in normalized evidence output.</p><a href='/about'>About us</a><a href='mailto:hello@example.test'>Email</a></main></body></html>");
  assert.ok(!page.text.includes("secret()"));
  assert.equal(page.links[0]?.href, "https://example.test/about");
  assert.deepEqual(page.mailtoEmails, ["hello@example.test"]);
});

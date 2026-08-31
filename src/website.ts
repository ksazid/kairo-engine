import * as cheerio from "cheerio";
import type { BrandBrainCandidate, EvidenceField, PageEvidence, Provenance, WebsiteEvidence } from "./contracts.js";

const MAX_BYTES = 2_000_000;
const PAGE_LIMIT = 8;
const TIMEOUT_MS = 12_000;
const PRIORITY_PATH = /\b(about|company|product|products|service|services|solution|solutions|pricing|contact|customers|features|platform)\b/i;
const SOCIAL_HOSTS = new Set(["instagram.com", "www.instagram.com", "facebook.com", "www.facebook.com", "linkedin.com", "www.linkedin.com", "youtube.com", "www.youtube.com", "x.com", "twitter.com", "github.com"]);

export async function collectWebsiteEvidence(input: string): Promise<WebsiteEvidence> {
  const source = normalizePublicUrl(input);
  const warnings: string[] = [];
  const pages: PageEvidence[] = [];
  const queue = [source];
  const visited = new Set<string>();

  while (queue.length && pages.length < PAGE_LIMIT) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    try {
      const page = await fetchPage(current);
      pages.push(page);
      const sameOrigin = page.links
        .map((link) => link.href)
        .filter((href) => sameSite(source, href) && !visited.has(href));
      const prioritized = sameOrigin.filter((href) => PRIORITY_PATH.test(new URL(href).pathname));
      const remainder = sameOrigin.filter((href) => !PRIORITY_PATH.test(new URL(href).pathname));
      for (const href of [...prioritized, ...remainder]) {
        if (queue.length + pages.length >= PAGE_LIMIT * 3) break;
        if (!queue.includes(href)) queue.push(href);
      }
    } catch (error) {
      warnings.push(`${current}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!pages.length) warnings.push("No usable HTML pages were collected");
  return { sourceUrl: input, canonicalSourceUrl: source, pages, warnings };
}

export function extractBrandBrain(evidence: WebsiteEvidence): BrandBrainCandidate {
  const home = evidence.pages[0];
  const allLinks = dedupe(evidence.pages.flatMap((p) => p.links.map((l) => l.href)));
  const sameSiteLinks = allLinks.filter((href) => sameSite(evidence.canonicalSourceUrl, href));
  const socialLinks = allLinks.filter((href) => SOCIAL_HOSTS.has(new URL(href).hostname.toLowerCase()));
  const jsonObjects = evidence.pages.flatMap((p) => flattenJsonLd(p.jsonLd));

  const org = jsonObjects.find((row) => hasType(row, ["Organization", "Corporation", "LocalBusiness", "Restaurant", "SoftwareApplication"]));
  const brandName = firstString(org?.name) ?? inferTitleName(home?.title);
  const description = firstString(org?.description) ?? home?.description ?? home?.paragraphs[0];

  const productNames = dedupe([
    ...jsonObjects.filter((row) => hasType(row, ["Product", "Service", "SoftwareApplication"])).flatMap((row) => [firstString(row.name), firstString(row.serviceType), firstString(row.applicationCategory)]),
    ...evidence.pages.flatMap((page) => page.links.filter((link) => /\/(products?|services?|solutions?|features?)(\/|$)/i.test(new URL(link.href).pathname)).map((link) => clean(link.text))),
  ].filter(isUsefulString)).slice(0, 30);

  const categories = dedupe(jsonObjects.flatMap((row) => [firstString(row.applicationCategory), firstString(row.category), firstString(row.industry), firstString(row.serviceType)]).filter(isUsefulString)).slice(0, 20);
  const audiences = dedupe(jsonObjects.flatMap((row) => extractAudience(row.audience)).filter(isUsefulString)).slice(0, 20);
  const locations = dedupe(jsonObjects.flatMap((row) => extractLocations(row.address)).filter(isUsefulString)).slice(0, 20);
  const emails = dedupe(evidence.pages.flatMap((page) => page.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((x) => x.toLowerCase())).slice(0, 20);

  const topicCandidates = evidence.pages.flatMap((page) => page.headings.slice(0, 12)).map(clean).filter((value) => value.length >= 4 && value.length <= 100);
  const topics = dedupe(topicCandidates).slice(0, 30);

  return {
    ...(brandName ? { brandName: field(brandName, evidence, "confirmed", org ? 0.98 : 0.82) } : {}),
    ...(description ? { description: field(description, evidence, "confirmed", org?.description ? 0.98 : home?.description ? 0.92 : 0.72) } : {}),
    categories: field(categories, evidence, categories.length ? "confirmed" : "unknown", categories.length ? 0.9 : 0),
    productsServices: field(productNames, evidence, productNames.length ? "inferred" : "unknown", productNames.length ? 0.78 : 0),
    audiences: field(audiences, evidence, audiences.length ? "confirmed" : "unknown", audiences.length ? 0.9 : 0),
    locations: field(locations, evidence, locations.length ? "confirmed" : "unknown", locations.length ? 0.9 : 0),
    topics: field(topics, evidence, topics.length ? "inferred" : "unknown", topics.length ? 0.65 : 0),
    contactEmails: field(emails, evidence, emails.length ? "confirmed" : "unknown", emails.length ? 0.95 : 0),
    socialLinks: field(socialLinks, evidence, socialLinks.length ? "confirmed" : "unknown", socialLinks.length ? 0.98 : 0),
    websiteLinks: field(sameSiteLinks.slice(0, 50), evidence, sameSiteLinks.length ? "confirmed" : "unknown", sameSiteLinks.length ? 0.98 : 0),
  };
}

async function fetchPage(url: string): Promise<PageEvidence> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "KairoEnginePublicEvidence/0.1 (+https://github.com/ksazid/kairo-engine)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error(`unsupported content-type ${contentType || "unknown"}`);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) throw new Error(`response exceeds ${MAX_BYTES} bytes`);
    const html = (await response.text()).slice(0, MAX_BYTES);
    return parsePage(response.url || url, response.status, html);
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePage(url: string, status: number, html: string): PageEvidence {
  const $ = cheerio.load(html);
  const retrievedAt = new Date().toISOString();
  const title = clean($("meta[property='og:title']").attr("content") ?? $("title").first().text());
  const description = clean($("meta[property='og:description']").attr("content") ?? $("meta[name='description']").attr("content") ?? "");
  const canonical = $("link[rel='canonical']").attr("href");
  const canonicalUrl = canonical ? safeAbsolute(canonical, url) : undefined;
  const jsonLd = $("script[type='application/ld+json']").toArray().flatMap((element) => {
    try { return [JSON.parse($(element).text()) as unknown]; } catch { return []; }
  });
  $("script,style,noscript,svg,template").remove();
  const headings = dedupe($("h1,h2,h3").toArray().map((el) => clean($(el).text())).filter(isUsefulString)).slice(0, 80);
  const paragraphs = dedupe($("p").toArray().map((el) => clean($(el).text())).filter((x) => x.length >= 30)).slice(0, 120);
  const links = dedupeLinks($("a[href]").toArray().flatMap((el) => {
    const href = safeAbsolute($(el).attr("href") ?? "", url);
    return href ? [{ href, text: clean($(el).text()).slice(0, 200) }] : [];
  }));
  const text = clean($("body").text()).slice(0, 120_000);
  return {
    url,
    status,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    headings,
    paragraphs,
    links,
    jsonLd,
    text,
    retrievedAt,
  };
}

function normalizePublicUrl(input: string): string {
  const candidate = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP(S) URLs are supported");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) throw new Error("Private/local destinations are not allowed");
  url.hash = "";
  return url.toString();
}

function sameSite(base: string, candidate: string): boolean {
  try {
    const a = new URL(base).hostname.replace(/^www\./, "");
    const b = new URL(candidate).hostname.replace(/^www\./, "");
    return a === b;
  } catch { return false; }
}

function safeAbsolute(value: string, base: string): string | undefined {
  if (!value || /^(mailto:|tel:|javascript:|data:)/i.test(value)) return undefined;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch { return undefined; }
}

function flattenJsonLd(values: unknown[]): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    output.push(row);
    if (Array.isArray(row["@graph"])) row["@graph"].forEach(visit);
  };
  values.forEach(visit);
  return output;
}

function hasType(row: Record<string, unknown>, types: string[]): boolean {
  const raw = row["@type"];
  const actual = Array.isArray(raw) ? raw : [raw];
  return actual.some((value) => typeof value === "string" && types.includes(value));
}

function extractAudience(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(extractAudience);
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return [firstString(row.audienceType), firstString(row.name)].filter(isUsefulString);
  }
  return [];
}

function extractLocations(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(extractLocations);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const parts = [row.streetAddress, row.addressLocality, row.addressRegion, row.postalCode, typeof row.addressCountry === "object" && row.addressCountry ? (row.addressCountry as Record<string, unknown>).name : row.addressCountry].map(firstString).filter(isUsefulString);
  return parts.length ? [parts.join(", ")] : [];
}

function field<T>(value: T, evidence: WebsiteEvidence, state: EvidenceField<T>["state"], confidence: number): EvidenceField<T> {
  const p = evidence.pages[0];
  const provenance: Provenance[] = p ? [{ sourceUrl: evidence.canonicalSourceUrl, pageUrl: p.url, retrievedAt: p.retrievedAt }] : [];
  return { value, state, confidence, provenance };
}

function firstString(value: unknown): string | undefined { return typeof value === "string" && clean(value) ? clean(value) : undefined; }
function inferTitleName(value?: string): string | undefined { if (!value) return undefined; return clean(value.split(/\s+[|–—-]\s+/)[0] ?? value).slice(0, 120) || undefined; }
function clean(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function isUsefulString(value: unknown): value is string { return typeof value === "string" && value.trim().length >= 2; }
function dedupe(values: string[]): string[] { return [...new Set(values.map(clean).filter(Boolean))]; }
function dedupeLinks(values: Array<{ href: string; text: string }>): Array<{ href: string; text: string }> { const seen = new Set<string>(); return values.filter((value) => seen.has(value.href) ? false : (seen.add(value.href), true)); }

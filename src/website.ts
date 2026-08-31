import * as cheerio from "cheerio";
import type { BrandBrainCandidate, EvidenceField, EvidenceState, PageEvidence, Provenance, RetrievalMode, WebsiteEvidence } from "./contracts.js";

const MAX_BYTES = 2_000_000;
const PAGE_LIMIT = 8;
const TIMEOUT_MS = 12_000;
const BROWSER_TIMEOUT_MS = 18_000;
const SITEMAP_LIMIT = 60;
const PRIORITY_PATH = /\b(about|company|product|products|service|services|solution|solutions|pricing|contact|customers|features|platform|menu|location|locations|payments|analytics|security|design|projects|docs|wiki)\b/i;
const ASSET_PATH = /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mov|mp3|mp4|mpeg|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)(?:$|\?)/i;
const CRAWL_DENY_PATH = /\/(?:cdn-cgi|wp-admin|wp-content|wp-includes|wp-json|api|auth|login|logout|signin|signup|register|cart|checkout)(?:\/|$)/i;
const PAGE_ROLE_PATH = /\/(about|company|products?|services?|solutions?|features?|menu|contact|locations?)(?:\/|$)/i;
const GENERIC_OFFERING = /^(?:products?|services?|solutions?|features?|platform|menu|pricing|learn|support|resources?|company|about(?: us)?|contact(?: us)?|customers?|partners?|developers?|documentation|docs|blog|news|careers?|more|overview|get started|start|sign in|log in|login|sign up|signup|register|skip to (?:main )?content|read the docs|create now|explore|see all solutions|for work|for life|home|download|try for free|book a demo|request a demo)$/i;
const GENERIC_TOPIC = /^(?:home|about|about us|contact|contact us|learn|support|resources?|company|products?|services?|solutions?|features?|platform|pricing|customers?|partners?|developers?|documentation|docs|blog|news|careers?|more|overview|free|standard|custom|recommended|current deals|social proof|in this article|summary|get started|sign in|log in|sign up|skip to (?:main )?content|download|try for free|book a demo|request a demo)$/i;
const LANGUAGE_LABEL = /^(?:english|español|spanish|deutsch|german|français|french|italiano|italian|nederlands|dutch|russian|bulgarian|hrvatski|čeština|czech|greek|hungarian|hindi|indonesian|עברית|日本語|繁體中文|简体中文|العربية|português|polski|svenska|dansk|norsk|suomi)$/i;
const JSON_RELATIONS = new Set(["@graph", "mainEntity", "itemListElement", "itemOffered", "offers", "hasOfferCatalog", "makesOffer", "hasMenu", "hasMenuSection", "hasMenuItem", "subjectOf", "provider", "publisher", "brand"]);

interface GroundedString {
  value: string;
  provenance: Provenance;
  confidence: number;
}

interface JsonRecord {
  row: Record<string, unknown>;
  page: PageEvidence;
}

interface IdentityCandidate {
  grounded: GroundedString;
  score: number;
  record?: JsonRecord;
}

class StaticFetchError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export async function collectWebsiteEvidence(input: string): Promise<WebsiteEvidence> {
  const source = normalizePublicUrl(input);
  const warnings: string[] = [];
  const pages: PageEvidence[] = [];
  const queue = [source];
  const visited = new Set<string>();
  let sitemapSeeded = false;

  while (queue.length && pages.length < PAGE_LIMIT) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    try {
      const page = await fetchPageResilient(current);
      pages.push(page);
      enqueueDiscoveredLinks(source, page, queue, visited, pages.length);
    } catch (error) {
      warnings.push(`${current}: ${error instanceof Error ? error.message : String(error)}`);
      if (!sitemapSeeded && pages.length === 0) {
        sitemapSeeded = true;
        const sitemapUrls = await discoverSitemapUrls(source).catch(() => [] as string[]);
        for (const href of sitemapUrls) {
          if (queue.length >= PAGE_LIMIT * 4) break;
          if (!visited.has(href) && !queue.includes(href)) queue.push(href);
        }
      }
    }
  }

  if (!pages.length) warnings.push("No usable HTML pages were collected");
  return { sourceUrl: input, canonicalSourceUrl: source, pages, warnings };
}

function enqueueDiscoveredLinks(source: string, page: PageEvidence, queue: string[], visited: Set<string>, pagesFetched: number): void {
  const sameOrigin = page.links
    .map((link) => crawlCanonical(link.href))
    .filter((href): href is string => Boolean(href))
    .filter((href) => sameSite(source, href) && likelyHtmlPage(href) && !visited.has(href));
  const prioritized = sameOrigin.filter((href) => PRIORITY_PATH.test(new URL(href).pathname));
  const remainder = sameOrigin.filter((href) => !PRIORITY_PATH.test(new URL(href).pathname));
  for (const href of dedupe([...prioritized, ...remainder])) {
    if (queue.length + pagesFetched >= PAGE_LIMIT * 3) break;
    if (!queue.includes(href)) queue.push(href);
  }
}

export function extractBrandBrain(evidence: WebsiteEvidence): BrandBrainCandidate {
  const home = evidence.pages[0];
  const records: JsonRecord[] = evidence.pages.flatMap((page) => flattenJsonLd(page.jsonLd).map((row) => ({ row, page })));
  const allPageLinks = evidence.pages.flatMap((page) => page.links.map((link) => ({ ...link, page })));
  const sameSiteLinkCandidates = allPageLinks.filter(({ href }) => sameSite(evidence.canonicalSourceUrl, href) && likelyHtmlPage(href));
  const websiteLinks = sameSiteLinkCandidates.map(({ href, page }) => grounded(href, evidence, page, "a[href]", href, 0.98));
  const socialLinks = allPageLinks.filter(({ href }) => isOfficialSocialProfile(href)).map(({ href, page }) => grounded(href, evidence, page, "a[href]", href, 0.98));
  const developerLinks = allPageLinks.filter(({ href }) => isDeveloperLink(href)).map(({ href, page }) => grounded(href, evidence, page, "a[href]", href, 0.95));

  const identity = selectIdentity(evidence, records);
  const brand = identity?.grounded;
  const structuredDescription = identity?.record ? firstString(identity.record.row.description) : undefined;
  const description = structuredDescription && identity?.record
    ? grounded(structuredDescription, evidence, identity.record.page, "script[type='application/ld+json']", structuredDescription, 0.96)
    : home?.description
      ? grounded(home.description, evidence, home, "meta[property='og:description'],meta[name='description']", home.description, 0.92)
      : home?.paragraphs[0]
        ? grounded(home.paragraphs[0], evidence, home, "main p,article p,p", home.paragraphs[0], 0.72)
        : undefined;

  const categoryCandidates = records.flatMap(({ row, page }) => [row.applicationCategory, row.category, row.industry, row.serviceType]
    .map(firstString)
    .filter(isUsefulString)
    .map((value) => grounded(value, evidence, page, "script[type='application/ld+json']", value, 0.9)));

  const audienceCandidates = records.flatMap(({ row, page }) => extractAudience(row.audience)
    .filter(isUsefulString)
    .map((value) => grounded(value, evidence, page, "script[type='application/ld+json']", value, 0.9)));

  const productCandidates = extractOfferings(evidence, records);
  const locationCandidates = extractGroundedLocations(evidence, records);
  const emailCandidates = extractGroundedEmails(evidence, records);
  const topicCandidates = evidence.pages.flatMap((page) => page.headings
    .map(clean)
    .filter(isGoodTopic)
    .map((value) => grounded(value, evidence, page, "main h1,main h2,main h3,article h1,article h2,article h3,h1,h2,h3", value, 0.66)));

  return {
    ...(brand ? { brandName: singleField(brand, "confirmed") } : {}),
    ...(description ? { description: singleField(description, "confirmed") } : {}),
    categories: listField(categoryCandidates, categoryCandidates.length ? "confirmed" : "unknown"),
    productsServices: listField(productCandidates, productCandidates.length ? "inferred" : "unknown"),
    audiences: listField(audienceCandidates, audienceCandidates.length ? "confirmed" : "unknown"),
    locations: listField(locationCandidates, locationCandidates.some((candidate) => candidate.confidence >= 0.9) ? "confirmed" : locationCandidates.length ? "inferred" : "unknown"),
    topics: listField(topicCandidates, topicCandidates.length ? "inferred" : "unknown"),
    contactEmails: listField(emailCandidates, emailCandidates.length ? "confirmed" : "unknown"),
    socialLinks: listField(socialLinks, socialLinks.length ? "confirmed" : "unknown"),
    developerLinks: listField(developerLinks, developerLinks.length ? "confirmed" : "unknown"),
    websiteLinks: listField(websiteLinks, websiteLinks.length ? "confirmed" : "unknown"),
  };
}

function selectIdentity(evidence: WebsiteEvidence, records: JsonRecord[]): IdentityCandidate | undefined {
  const home = evidence.pages[0];
  const candidates: IdentityCandidate[] = [];
  const hostLabel = baseHostLabel(evidence.canonicalSourceUrl);

  if (home?.siteName && !isGenericIdentity(home.siteName)) {
    candidates.push({
      grounded: grounded(home.siteName, evidence, home, "meta[property='og:site_name'],meta[name='application-name']", home.siteName, 0.97),
      score: 97 + identityAffinity(home.siteName, hostLabel, home),
    });
  }

  const titleCandidate = titleIdentity(home, evidence);
  if (titleCandidate) candidates.push({ grounded: titleCandidate, score: 82 + identityAffinity(titleCandidate.value, hostLabel, home) });

  for (const record of records) {
    if (!hasType(record.row, ["Organization", "Corporation", "LocalBusiness", "Restaurant", "Brand", "SoftwareApplication"])) continue;
    const name = firstString(record.row.name);
    if (!name || isGenericIdentity(name)) continue;
    let score = 70 + identityAffinity(name, hostLabel, home);
    if (isHomePage(record.page.url, evidence.canonicalSourceUrl)) score += 8;
    const entityUrl = firstString(record.row.url) ?? firstString(record.row["@id"]);
    if (entityUrl) {
      const absolute = safeAbsolute(entityUrl, record.page.url);
      if (absolute && sameSite(evidence.canonicalSourceUrl, absolute)) score += 20;
      else if (absolute && !sameSite(evidence.canonicalSourceUrl, absolute)) score -= 35;
    }
    if (hasType(record.row, ["SoftwareApplication"]) && !nameAffinity(name, hostLabel, home?.siteName, home?.title)) score -= 10;
    candidates.push({
      grounded: grounded(name, evidence, record.page, "script[type='application/ld+json']", name, Math.min(0.98, Math.max(0.65, score / 100))),
      score,
      record,
    });
  }

  return candidates.sort((a, b) => b.score - a.score)[0];
}

function identityAffinity(name: string, hostLabel: string, home?: PageEvidence): number {
  let score = 0;
  const normalized = compact(name);
  const host = compact(hostLabel);
  if (normalized.includes(host) || host.includes(normalized)) score += 18;
  if (home?.siteName && namesOverlap(name, home.siteName)) score += 12;
  if (home?.title && namesOverlap(name, home.title)) score += 8;
  return score;
}

function nameAffinity(name: string, hostLabel: string, siteName?: string, title?: string): boolean {
  return compact(name).includes(compact(hostLabel)) || compact(hostLabel).includes(compact(name)) || Boolean(siteName && namesOverlap(name, siteName)) || Boolean(title && namesOverlap(name, title));
}

function namesOverlap(a: string, b: string): boolean {
  const aa = significantTokens(a);
  const bb = new Set(significantTokens(b));
  return aa.some((token) => bb.has(token));
}

function significantTokens(value: string): string[] {
  return clean(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && !new Set(["the", "and", "for", "with", "your", "app", "official", "home"]).has(token));
}

function extractOfferings(evidence: WebsiteEvidence, records: JsonRecord[]): GroundedString[] {
  const structured = records.flatMap(({ row, page }) => {
    const typed = hasType(row, ["Product", "Service", "SoftwareApplication", "MenuItem", "OfferCatalog"]);
    if (!typed) return [];
    return [row.name, row.serviceType, row.applicationCategory]
      .map(firstString)
      .filter(isGoodOffering)
      .map((value) => grounded(value, evidence, page, "script[type='application/ld+json']", value, 0.96));
  });

  const linkOccurrences = new Map<string, { count: number; candidate: GroundedString }>();
  for (const page of evidence.pages) {
    for (const link of page.links) {
      if (!sameSite(evidence.canonicalSourceUrl, link.href) || !likelyHtmlPage(link.href)) continue;
      const label = offeringLabel(link.href, link.text);
      if (!label || !isGoodOffering(label)) continue;
      const path = new URL(link.href).pathname;
      const depth = path.split("/").filter(Boolean).length;
      const semantic = PRIORITY_PATH.test(path) || depth === 1;
      if (!semantic) continue;
      const key = `${label.toLowerCase()}|${crawlCanonical(link.href) ?? link.href}`;
      const existing = linkOccurrences.get(key);
      const candidate = grounded(label, evidence, page, "a[href]", link.text || link.href, depth === 1 ? 0.78 : 0.84);
      linkOccurrences.set(key, { count: (existing?.count ?? 0) + 1, candidate });
    }
  }
  const linkCandidates = [...linkOccurrences.values()]
    .filter(({ count, candidate }) => count >= 2 || PRIORITY_PATH.test(new URL(candidate.provenance.evidenceText?.startsWith("http") ? candidate.provenance.evidenceText : candidate.provenance.pageUrl).pathname) || candidate.confidence >= 0.78)
    .map(({ candidate }) => candidate);

  const roleHeadings = evidence.pages.flatMap((page) => {
    const role = pageRole(page.url);
    if (!new Set(["product", "service", "solution", "feature", "menu"]).has(role)) return [];
    return page.headings.filter(isGoodOffering).map((value) => grounded(value, evidence, page, "main h1,main h2,main h3,article h1,article h2,article h3,h1,h2,h3", value, 0.82));
  });

  const fallbackHeadings = evidence.pages.slice(0, 3).flatMap((page) => page.headings
    .filter((value) => value.length <= 60 && isGoodOffering(value) && looksProductivePhrase(value))
    .map((value) => grounded(value, evidence, page, "main h1,main h2,main h3,article h1,article h2,article h3,h1,h2,h3", value, 0.64)));

  return uniqueCandidates([...structured, ...linkCandidates, ...roleHeadings, ...fallbackHeadings]).slice(0, 40);
}

function extractGroundedLocations(evidence: WebsiteEvidence, records: JsonRecord[]): GroundedString[] {
  const structured = records.flatMap(({ row, page }) => [row.address, row.location]
    .flatMap(extractLocations)
    .filter(isUsefulString)
    .map((value) => grounded(value, evidence, page, "script[type='application/ld+json']", value, 0.96)));

  const addressBlocks = evidence.pages.flatMap((page) => page.addressBlocks
    .filter((value) => value.length <= 260 && (looksLikeAddress(value) || looksLikeLocality(value)))
    .map((value) => grounded(value, evidence, page, "address,[itemprop='address'],[itemprop='streetAddress'],[class*='address'],[id*='address']", value, 0.9)));

  const contextual = evidence.pages.flatMap((page) => page.paragraphs
    .filter((value) => value.length <= 220 && looksLikeAddress(value))
    .map((value) => grounded(value, evidence, page, "main p,article p,p", value, pageRole(page.url) === "contact" || pageRole(page.url) === "location" ? 0.82 : 0.68)));

  return uniqueCandidates([...structured, ...addressBlocks, ...contextual]).slice(0, 20);
}

function extractGroundedEmails(evidence: WebsiteEvidence, records: JsonRecord[]): GroundedString[] {
  const structured = records.flatMap(({ row, page }) => extractEmailValues(row.email)
    .filter(isContactEmail)
    .map((value) => grounded(value, evidence, page, "script[type='application/ld+json']", value, 0.98)));
  const mailto = evidence.pages.flatMap((page) => page.mailtoEmails
    .filter(isContactEmail)
    .map((value) => grounded(value, evidence, page, "a[href^='mailto:']", value, 0.98)));
  const contextual = evidence.pages.flatMap((page) => {
    if (!new Set(["contact", "about", "company"]).has(pageRole(page.url))) return [];
    return (page.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
      .map((value) => value.toLowerCase())
      .filter(isContactEmail)
      .map((value) => grounded(value, evidence, page, "main,article,body", value, 0.84));
  });
  return uniqueCandidates([...structured, ...mailto, ...contextual]).slice(0, 20);
}

async function fetchPageResilient(url: string): Promise<PageEvidence> {
  try {
    const page = await fetchStaticPage(url);
    if (!looksBlocked(page)) return page;
  } catch (error) {
    if (!(error instanceof StaticFetchError) || !error.retryable) throw error;
  }
  return fetchBrowserPage(url);
}

async function fetchStaticPage(url: string): Promise<PageEvidence> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "KairoEnginePublicEvidence/0.3 (+https://github.com/ksazid/kairo-engine)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      },
    });
    if (!response.ok) throw new StaticFetchError(`HTTP ${response.status}`, [403, 429, 503].includes(response.status));
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new StaticFetchError(`unsupported content-type ${contentType || "unknown"}`, false);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) throw new StaticFetchError(`response exceeds ${MAX_BYTES} bytes`, false);
    const html = (await response.text()).slice(0, MAX_BYTES);
    return parsePage(response.url || url, response.status, html, "http");
  } catch (error) {
    if (error instanceof StaticFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new StaticFetchError(`timeout after ${TIMEOUT_MS}ms`, true);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBrowserPage(url: string): Promise<PageEvidence> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 KairoEngine/0.3",
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    const status = response?.status() ?? 200;
    if (status >= 400) throw new Error(`browser HTTP ${status}`);
    const html = (await page.content()).slice(0, MAX_BYTES);
    const parsed = parsePage(page.url(), status, html, "browser");
    if (looksBlocked(parsed)) throw new Error("browser fallback returned a block/challenge page");
    return parsed;
  } finally {
    await browser.close();
  }
}

async function discoverSitemapUrls(source: string): Promise<string[]> {
  const base = new URL(source);
  const root = `${base.protocol}//${base.host}`;
  const sitemapCandidates = new Set<string>([`${root}/sitemap.xml`, `${root}/sitemap_index.xml`]);
  const robots = await fetchText(`${root}/robots.txt`, 300_000).catch(() => "");
  for (const line of robots.split(/\r?\n/)) {
    const match = line.match(/^\s*Sitemap:\s*(https?:\/\/\S+)/i);
    if (match?.[1] && sameSite(source, match[1])) sitemapCandidates.add(match[1]);
  }

  const discovered = new Set<string>();
  const visitedSitemaps = new Set<string>();
  const queue = [...sitemapCandidates];
  while (queue.length && discovered.size < SITEMAP_LIMIT && visitedSitemaps.size < 8) {
    const sitemap = queue.shift();
    if (!sitemap || visitedSitemaps.has(sitemap)) continue;
    visitedSitemaps.add(sitemap);
    const xml = await fetchText(sitemap, MAX_BYTES).catch(() => "");
    if (!xml) continue;
    const $ = cheerio.load(xml, { xmlMode: true });
    for (const element of $("loc").toArray()) {
      const loc = clean($(element).text());
      if (!loc || !sameSite(source, loc)) continue;
      if (/\.xml(?:$|\?)/i.test(new URL(loc).pathname)) {
        if (!visitedSitemaps.has(loc)) queue.push(loc);
        continue;
      }
      const canonical = crawlCanonical(loc);
      if (canonical && likelyHtmlPage(canonical)) discovered.add(canonical);
      if (discovered.size >= SITEMAP_LIMIT) break;
    }
  }
  return [...discovered].sort((a, b) => Number(PRIORITY_PATH.test(new URL(b).pathname)) - Number(PRIORITY_PATH.test(new URL(a).pathname))).slice(0, PAGE_LIMIT * 4);
}

async function fetchText(url: string, maxBytes: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "KairoEnginePublicEvidence/0.3 (+https://github.com/ksazid/kairo-engine)", accept: "text/plain,application/xml,text/xml,*/*;q=0.1" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > maxBytes) throw new Error("response too large");
    return (await response.text()).slice(0, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePage(url: string, status: number, html: string, retrievalMode: RetrievalMode = "http"): PageEvidence {
  const $ = cheerio.load(html);
  const retrievedAt = new Date().toISOString();
  const title = clean($("meta[property='og:title']").attr("content") ?? $("title").first().text());
  const siteName = clean($("meta[property='og:site_name']").attr("content") ?? $("meta[name='application-name']").attr("content") ?? "");
  const description = clean($("meta[property='og:description']").attr("content") ?? $("meta[name='description']").attr("content") ?? "");
  const canonical = $("link[rel='canonical']").attr("href");
  const canonicalUrl = canonical ? safeAbsolute(canonical, url) : undefined;
  const mailtoEmails = dedupe($("a[href^='mailto:']").toArray().flatMap((element) => parseMailto($(element).attr("href") ?? "")));
  const addressBlocks = extractDomAddressBlocks($);
  const jsonLd = $("script[type='application/ld+json']").toArray().flatMap((element) => {
    try { return [JSON.parse($(element).text()) as unknown]; } catch { return []; }
  });
  const links = dedupeLinks($("a[href]").toArray().flatMap((element) => {
    const href = safeAbsolute($(element).attr("href") ?? "", url);
    return href ? [{ href, text: clean($(element).text()).slice(0, 200) }] : [];
  }));

  const contentRoot = $("main,article").first().length ? $("main,article").first().clone() : $("body").clone();
  contentRoot.find("script,style,noscript,svg,template,nav,header,footer,aside,dialog,[role='navigation'],[role='menu'],[aria-hidden='true']").remove();
  const headings = dedupe(contentRoot.find("h1,h2,h3").toArray().map((element) => clean($(element).text())).filter(isUsefulString)).slice(0, 100);
  const paragraphs = dedupe(contentRoot.find("p").toArray().map((element) => clean($(element).text())).filter((value) => value.length >= 20)).slice(0, 160);
  const text = clean(contentRoot.text()).slice(0, 120_000);

  return {
    url,
    status,
    retrievalMode,
    ...(title ? { title } : {}),
    ...(siteName ? { siteName } : {}),
    ...(description ? { description } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    headings,
    paragraphs,
    addressBlocks,
    mailtoEmails,
    links,
    jsonLd,
    text,
    retrievedAt,
  };
}

function extractDomAddressBlocks($: cheerio.CheerioAPI): string[] {
  const blocks = $("address,[itemprop='address'],[class*='address'],[id*='address']").toArray()
    .map((element) => clean($(element).text()))
    .filter((value) => value.length >= 5 && value.length <= 500);
  const components = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
    .flatMap((itemprop) => $(`[itemprop='${itemprop}']`).toArray().map((element) => clean($(element).attr("content") ?? $(element).text())))
    .filter(isUsefulString);
  if (components.length) blocks.push(components.join(", "));
  return dedupe(blocks);
}

function titleIdentity(home: PageEvidence | undefined, evidence: WebsiteEvidence): GroundedString | undefined {
  if (!home?.title) return undefined;
  const parts = home.title.split(/\s+[|–—-]\s+/).map(clean).filter(Boolean);
  const hostLabel = baseHostLabel(evidence.canonicalSourceUrl);
  const matching = parts.find((part) => compact(part).includes(compact(hostLabel)) || compact(hostLabel).includes(compact(part)));
  const value = matching ?? parts.at(-1) ?? parts[0];
  if (!value || isGenericIdentity(value)) return undefined;
  return grounded(value.slice(0, 120), evidence, home, "title,meta[property='og:title']", value, matching ? 0.9 : 0.78);
}

function offeringLabel(href: string, text: string): string | undefined {
  const cleanedText = clean(text);
  if (cleanedText && cleanedText.length <= 70 && !GENERIC_OFFERING.test(cleanedText) && !LANGUAGE_LABEL.test(cleanedText)) return cleanedText;
  const segments = new URL(href).pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (!last || GENERIC_OFFERING.test(last)) return undefined;
  return humanizeSlug(last);
}

function isGoodOffering(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = clean(value);
  return normalized.length >= 2 && normalized.length <= 80 && !GENERIC_OFFERING.test(normalized) && !LANGUAGE_LABEL.test(normalized) && !/^(?:\$|€|£)?\d+(?:[.,]\d+)?(?:%|\s*\/|$)/.test(normalized) && normalized.split(/\s+/).length <= 10;
}

function looksProductivePhrase(value: string): boolean {
  return /\b(?:payment|analytics|monitor|error|replay|trace|project|issue|wiki|docs|design|dev|commerce|store|pos|security|cloud|network|worker|erp|payroll|reservation|menu|breakfast|pizza|pasta|burger|fish|meat|feature|ai)\b/i.test(value);
}

function isGoodTopic(value: string): boolean {
  const normalized = clean(value);
  return normalized.length >= 4 && normalized.length <= 100 && !GENERIC_TOPIC.test(normalized) && !LANGUAGE_LABEL.test(normalized) && normalized.split(/\s+/).length <= 15;
}

function isGenericIdentity(value: string): boolean {
  const normalized = clean(value);
  return !normalized || GENERIC_TOPIC.test(normalized) || /^(?:website|homepage|video|vimeo|youtube)$/i.test(normalized);
}

function isOfficialSocialProfile(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "instagram.com") return parts.length === 1 && !new Set(["p", "reel", "stories", "explore"]).has(parts[0]?.toLowerCase() ?? "");
    if (host === "facebook.com") return parts.length >= 1 && parts.length <= 2 && !/^(?:share|sharer|watch|reel|groups|events)$/i.test(parts[0] ?? "");
    if (host === "linkedin.com") return parts.length === 2 && /^(?:company|in)$/i.test(parts[0] ?? "");
    if (host === "youtube.com") return parts.length >= 1 && /^(?:@|channel|user|c)/i.test(parts[0] ?? "");
    if (host === "x.com" || host === "twitter.com") return parts.length === 1 && !/^(?:intent|share|home|search|i)$/i.test(parts[0] ?? "");
    if (host === "github.com") return parts.length === 1 && !/^(?:pricing|features|marketplace|settings|login|signup)$/i.test(parts[0] ?? "");
    return false;
  } catch { return false; }
}

function isDeveloperLink(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    return host === "github.com" && parts.length >= 2 && !new Set(["orgs", "settings", "marketplace", "site", "contact"]).has(parts[0] ?? "");
  } catch { return false; }
}

function isContactEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return false;
  const [local = "", domain = ""] = normalized.split("@");
  if (!local || !domain || local.includes("example") || domain.includes("example") || /(^|\.)ingest(?:\.|$)/.test(domain) || /^[a-f0-9]{20,}$/i.test(local)) return false;
  return true;
}

function looksLikeAddress(value: string): boolean {
  const normalized = clean(value);
  if (normalized.length < 5 || normalized.length > 260) return false;
  if (/\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|drive|dr\.?|way|place|plaza|square|complex|centre|center|mall|building|suite|floor|triq|via|calle|rue|strasse|straße|malta)\b/i.test(normalized)) return true;
  if (/\b[A-Z]{1,4}\s?\d{3,6}\b/.test(normalized) && /[,\s]/.test(normalized)) return true;
  return /\d/.test(normalized) && (normalized.match(/,/g)?.length ?? 0) >= 2;
}

function looksLikeLocality(value: string): boolean {
  return /\b(?:malta|gozo|marsascala|marsaskala|qormi|mosta|st\.? paul(?:'s)? bay|saint paul(?:'s)? bay|valletta|sliema|gżira|gzira)\b/i.test(value);
}

function pageRole(url: string): string {
  const match = new URL(url).pathname.toLowerCase().match(PAGE_ROLE_PATH);
  const raw = match?.[1] ?? "home";
  if (/^products?$/.test(raw)) return "product";
  if (/^services?$/.test(raw)) return "service";
  if (/^solutions?$/.test(raw)) return "solution";
  if (/^features?$/.test(raw)) return "feature";
  if (/^locations?$/.test(raw)) return "location";
  return raw;
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

function crawlCanonical(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch { return undefined; }
}

function likelyHtmlPage(value: string): boolean {
  try {
    const url = new URL(value);
    if (ASSET_PATH.test(url.pathname) || CRAWL_DENY_PATH.test(url.pathname)) return false;
    return true;
  } catch { return false; }
}

function sameSite(base: string, candidate: string): boolean {
  try {
    const a = new URL(base).hostname.replace(/^www\./, "");
    const b = new URL(candidate).hostname.replace(/^www\./, "");
    return a === b;
  } catch { return false; }
}

function isHomePage(pageUrl: string, sourceUrl: string): boolean {
  try {
    const page = new URL(pageUrl);
    const source = new URL(sourceUrl);
    return page.hostname.replace(/^www\./, "") === source.hostname.replace(/^www\./, "") && (page.pathname === "/" || page.pathname === "");
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

function parseMailto(value: string): string[] {
  if (!/^mailto:/i.test(value)) return [];
  try {
    const decoded = decodeURIComponent(value.replace(/^mailto:/i, "").split("?")[0] ?? "");
    return decoded.split(/[;,]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  } catch { return []; }
}

function flattenJsonLd(values: unknown[]): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, key?: string): void => {
    if (!value || (typeof value !== "object" && !Array.isArray(value))) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    const row = value as Record<string, unknown>;
    output.push(row);
    for (const [childKey, child] of Object.entries(row)) {
      if (JSON_RELATIONS.has(childKey) || childKey.startsWith("has") || childKey.endsWith("Entity") || childKey.endsWith("Element")) visit(child, childKey);
    }
  };
  values.forEach((value) => visit(value));
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
  if (typeof value === "string") return [clean(value)];
  if (Array.isArray(value)) return value.flatMap(extractLocations);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  if (row.address) return extractLocations(row.address);
  const parts = [row.streetAddress, row.addressLocality, row.addressRegion, row.postalCode, typeof row.addressCountry === "object" && row.addressCountry ? (row.addressCountry as Record<string, unknown>).name : row.addressCountry]
    .map(firstString)
    .filter(isUsefulString);
  return parts.length ? [parts.join(", ")] : [];
}

function extractEmailValues(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(extractEmailValues);
  return [];
}

function grounded(value: string, evidence: WebsiteEvidence, page: PageEvidence, selector: string, evidenceText: string, confidence: number): GroundedString {
  return {
    value: clean(value),
    confidence,
    provenance: {
      sourceUrl: evidence.canonicalSourceUrl,
      pageUrl: page.url,
      retrievedAt: page.retrievedAt,
      selector,
      evidenceText: clean(evidenceText).slice(0, 500),
    },
  };
}

function singleField(candidate: GroundedString, state: EvidenceState): EvidenceField<string> {
  return { value: candidate.value, state, confidence: candidate.confidence, provenance: [candidate.provenance] };
}

function listField(candidates: GroundedString[], state: EvidenceState): EvidenceField<string[]> {
  const unique = uniqueCandidates(candidates);
  return {
    value: unique.map((candidate) => candidate.value),
    state: unique.length ? state : "unknown",
    confidence: unique.length ? Math.max(...unique.map((candidate) => candidate.confidence)) : 0,
    provenance: unique.map((candidate) => candidate.provenance),
  };
}

function uniqueCandidates(values: GroundedString[]): GroundedString[] {
  const seen = new Set<string>();
  return values.filter((candidate) => {
    const key = candidate.value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function looksBlocked(page: PageEvidence): boolean {
  const probe = `${page.title ?? ""} ${page.text.slice(0, 500)}`;
  return /just a moment|checking your browser|access denied|enable javascript and cookies|verify you are human|attention required/i.test(probe);
}

function humanizeSlug(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()).trim();
}

function baseHostLabel(value: string): string {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  return host.split(".")[0] ?? host;
}

function compact(value: string): string { return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function firstString(value: unknown): string | undefined { return typeof value === "string" && clean(value) ? clean(value) : undefined; }
function clean(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function isUsefulString(value: unknown): value is string { return typeof value === "string" && value.trim().length >= 2; }
function dedupe(values: string[]): string[] { return [...new Set(values.map(clean).filter(Boolean))]; }
function dedupeLinks(values: Array<{ href: string; text: string }>): Array<{ href: string; text: string }> { const seen = new Set<string>(); return values.filter((value) => seen.has(value.href) ? false : (seen.add(value.href), true)); }

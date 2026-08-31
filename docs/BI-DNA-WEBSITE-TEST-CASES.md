# Brand Intelligence / Brand DNA — Website Certification Test Cases

## Purpose

This is the acceptance matrix for public-website onboarding before website evidence is allowed to feed Kairo Brand Brain.

The test objective is **not** to make a website alone produce a 100% Brand Intelligence score. The objective is to extract every defensible Brand-DNA field the website can support, attach exact provenance, and leave unsupported fields explicitly missing so Kairo can request another source or owner confirmation.

## Kairo Brand-DNA readiness groups

Kairo currently evaluates these readiness groups:

1. **Business** — `identity.description`, `identity.category`, `identity.sector`, `identity.subsector`
2. **Offerings** — `identity.products-services`, `identity.offers`
3. **Audience** — `audience.primary`
4. **Positioning** — `positioning.value-proposition`, `positioning.differentiation`, `positioning.market-position`
5. **Topics** — `content.core-topics`, `content.preferred-topics`, `content.pillars`, `content.related-topics`
6. **Boundaries** — `boundaries.excluded-topics`, `boundaries.prohibited-subjects`, `boundaries.claims-to-avoid`
7. **Geography** — `identity.geography` when the business is location-dependent

### Website responsibility

| DNA area | Website expectation | Rule |
|---|---|---|
| Business | Required when publicly stated | Extract and ground |
| Offerings | Required when publicly stated | Extract concrete products/services/offers |
| Audience | Best effort | Infer only from explicit audience/customer language; otherwise unknown |
| Positioning | Required when publicly stated | Extract value proposition/differentiation/market position |
| Topics | Required when enough content exists | Derive only from repeated grounded source themes |
| Geography | Required for local/location-dependent sites | Extract locations/service areas |
| Boundaries | Conservative only | Extract only explicit restrictions/disclaimers; never invent from absence |
| Goals | Not a website-readiness requirement | Owner/product intent should remain user-confirmed unless explicitly published |
| Voice | Supplemental | Can be profiled from sufficient source text but must remain inferred |
| Visual direction | Supplemental | Requires image/logo/color evidence; text crawl alone is insufficient |

## Certification rule

A public website adapter passes only if it:

- returns grounded evidence rather than fabricated completeness;
- maps extractable facts to canonical Brand-DNA field keys;
- attaches page-level and evidence-level provenance;
- distinguishes inferred/confirmed/unknown/conflicting states;
- preserves missing DNA dimensions as gaps;
- never increases Brand Intelligence readiness by manufacturing boundaries, audience, positioning or geography;
- is deterministic for the same captured source fixture;
- remains bounded and safe under redirects, large pages, JS-heavy pages and malformed structured data.

---

# Test Case Matrix

## A. URL, routing and security

| ID | Test | Expected result |
|---|---|---|
| WD-001 | Plain HTTPS homepage | Canonical website source created |
| WD-002 | HTTP URL redirects to HTTPS | Final canonical HTTPS URL retained with redirect provenance |
| WD-003 | URL with tracking parameters | Tracking parameters removed without changing identity |
| WD-004 | `www` / non-`www` variants | Same brand source identity; no duplicate evidence |
| WD-005 | Deep product URL | Crawl can recover brand root and product evidence |
| WD-006 | Localhost/private IP target | Rejected before retrieval |
| WD-007 | Redirect chain ending at private address | Rejected; no private fetch performed |
| WD-008 | Non-HTTP(S) scheme | Rejected |
| WD-009 | Cross-domain canonical tag | Does not silently switch brand ownership without validation |
| WD-010 | Malformed URL | Validation failure, not crawler crash |

## B. Retrieval and crawl behavior

| ID | Test | Expected result |
|---|---|---|
| WD-011 | Static HTML site | HTTP path succeeds without browser |
| WD-012 | JS-heavy site with empty shell | Browser fallback recovers usable evidence |
| WD-013 | Static fetch blocked but public browser page works | Bounded browser fallback succeeds |
| WD-014 | Root blocked but sitemap is public | Sitemap recovery finds relevant public pages |
| WD-015 | Huge page | Response/content limits enforced |
| WD-016 | Slow page | Timeout is bounded and warning is recorded |
| WD-017 | Infinite calendar/filter links | Crawl budget prevents explosion |
| WD-018 | Duplicate canonical pages | Deduplicated |
| WD-019 | Login/auth wall | Classified unavailable/degraded; wall text not treated as Brand DNA |
| WD-020 | Cookie banner/navigation-heavy page | Boilerplate is suppressed from extracted facts |
| WD-021 | Documentation subdomain | Recognized as supporting/control evidence, not automatically the primary commercial site |
| WD-022 | Multi-language pages | Language variants do not become separate products/topics |

## C. Identity and business classification

| ID | Test | Expected result |
|---|---|---|
| WD-023 | Brand name in Organization JSON-LD | Correct `brandName` / canonical identity |
| WD-024 | Third-party embedded JSON-LD | Third-party organization cannot override document/site identity |
| WD-025 | Brand name only in OG/site metadata | Correct identity recovered |
| WD-026 | Product page title starts with product name | Parent brand remains brand identity |
| WD-027 | `About` page contains clearer description | Description provenance points to the exact page/evidence text |
| WD-028 | SaaS company | Category/sector/subsector terms recovered when grounded |
| WD-029 | Restaurant/local business | Local-business category and geography recovered |
| WD-030 | Sparse landing page | Missing category/sector remains unknown rather than guessed |

## D. Products, services and offers

| ID | Test | Expected result |
|---|---|---|
| WD-031 | Product cards | Concrete product names/features recovered |
| WD-032 | Service-company services page | Services recovered as offerings |
| WD-033 | Nested JSON-LD ItemList/Product graph | Nested catalog offerings recovered |
| WD-034 | Restaurant menu | Menu/category offerings recovered without treating every ingredient as a product |
| WD-035 | Pricing plans | Plans/offers can be separated from core products where possible |
| WD-036 | Navigation labels such as Support/Learn/More | Must not become products/services |
| WD-037 | Language labels | Must not become products/services |
| WD-038 | Repeated duplicate offerings | Deduplicated while retaining provenance |

## E. Audience

| ID | Test | Expected result |
|---|---|---|
| WD-039 | Explicit “for startups” / “for enterprises” copy | `audience.primary` can be inferred with provenance |
| WD-040 | Persona/industry customer pages | Multiple grounded audience segments can be represented |
| WD-041 | Customer logos only | Do not invent audience semantics from logos alone |
| WD-042 | No audience language | Audience remains unknown/gap |
| WD-043 | Ambiguous “teams” language | Low-confidence inference or unknown; never confirmed |

## F. Positioning

| ID | Test | Expected result |
|---|---|---|
| WD-044 | Clear hero value proposition | `positioning.value-proposition` extracted with exact provenance |
| WD-045 | Explicit “unlike/alternative/faster/cheaper” copy | `positioning.differentiation` extracted |
| WD-046 | Explicit category leadership / premium / specialist language | `positioning.market-position` extracted conservatively |
| WD-047 | Generic slogan only | Do not manufacture a value proposition |
| WD-048 | Third-party testimonial claims superiority | Do not promote testimonial wording to brand-confirmed differentiation |

## G. Topics and content intelligence

| ID | Test | Expected result |
|---|---|---|
| WD-049 | Blog/resources with recurring themes | Core/related topics derived from repeated grounded themes |
| WD-050 | Single isolated article | Topic should not dominate core-topic profile |
| WD-051 | Footer/nav repeated everywhere | Navigation boilerplate does not become a core topic |
| WD-052 | Product terminology repeated across pages | Can feed `content.terminology` / core topics with provenance |
| WD-053 | Documentation-heavy technical brand | Technical topics retained without treating UI labels as topics |
| WD-054 | Sparse brochure site | Topic coverage remains partial rather than hallucinated |

## H. Geography and local-business intelligence

| ID | Test | Expected result |
|---|---|---|
| WD-055 | LocalBusiness/PostalAddress JSON-LD | Exact business location recovered |
| WD-056 | Microdata postal address | Address recovered |
| WD-057 | Multiple branches | All legitimate locations retained and deduplicated |
| WD-058 | Service-area wording | Service geography represented separately from a physical address where possible |
| WD-059 | Address inside footer only | Can be used with exact page/selector provenance |
| WD-060 | SaaS site with corporate HQ only | HQ must not automatically become customer/service geography |

## I. Boundaries, claims and safety

| ID | Test | Expected result |
|---|---|---|
| WD-061 | Explicit regulated disclaimer | May populate claims/restrictions only with exact evidence |
| WD-062 | Explicit prohibited-use/subject wording | Can contribute to boundaries |
| WD-063 | No boundary language | Boundaries remain unknown and readiness reports a gap |
| WD-064 | Terms/privacy boilerplate | Must not automatically become content boundaries |
| WD-065 | Medical/legal/financial claim language | Retain as evidence; do not infer permission to make equivalent claims |

## J. Contact, social and link precision

| ID | Test | Expected result |
|---|---|---|
| WD-066 | `mailto:` contact | Valid contact email extracted |
| WD-067 | Telemetry/DSN/error-ingest strings | Never treated as contact email |
| WD-068 | GitHub link | Developer link, not social/customer channel |
| WD-069 | Instagram/Facebook/LinkedIn/YouTube links | Normalized as social links |
| WD-070 | External partner links | Must not be treated as brand-owned social profiles without evidence |

## K. Provenance, evidence state and conflicts

| ID | Test | Expected result |
|---|---|---|
| WD-071 | Every extracted DNA field | Has source URL, exact page URL and evidence snippet/selector when applicable |
| WD-072 | Same fact on two pages | Provenance can contain both independent evidence records |
| WD-073 | Conflicting addresses | State becomes conflicting or facts remain separately attributed |
| WD-074 | Old vs current product wording | Current canonical evidence preferred without silently deleting historical/conflicting evidence |
| WD-075 | Extractor confidence | Confidence is bounded and evidence-dependent |
| WD-076 | Website-generated fact | State is inferred unless explicitly user-confirmed elsewhere |
| WD-077 | Missing fact | Unknown/gap; no placeholder prose presented as fact |

## L. Brand Intelligence readiness integration

| ID | Test | Expected result |
|---|---|---|
| WD-078 | Strong SaaS website | Business + offerings + positioning + topics should contribute materially to readiness |
| WD-079 | Strong local-business website | Business + offerings + geography + positioning/topics should contribute materially |
| WD-080 | Website with no audience evidence | Audience gap remains visible |
| WD-081 | Website with no explicit boundaries | Boundaries gap remains visible; next action can ask owner to confirm none |
| WD-082 | One website source only | Evidence coverage reflects one source; confidence is not falsely treated as multi-source confirmation |
| WD-083 | Add second independent source agreeing with website | Evidence coverage/confidence may increase after merge |
| WD-084 | Second source conflicts with website | Conflict reduces certainty and is surfaced for resolution |
| WD-085 | User confirms an inferred field | Confirmed value becomes authoritative over later inferred refreshes |
| WD-086 | Website refresh changes an inferred field | Inferred value may update with new provenance/version |
| WD-087 | Website refresh disagrees with confirmed field | Confirmed user value is preserved; conflict/new evidence is recorded |
| WD-088 | Location-independent business | Geography can be non-required in readiness evaluation |
| WD-089 | Location-dependent business | Geography is required in readiness evaluation |
| WD-090 | Complete extractable website DNA but no boundaries | Status should remain `needs-enrichment`, not falsely `ready` |

## M. Real-site certification matrix

The live regression matrix currently includes these independent shapes:

1. Stripe — large SaaS / financial platform
2. Linear — blocked/JS-heavy SaaS
3. PostHog — content-heavy SaaS
4. Cloudflare — multi-product cloud platform
5. Sentry — developer tooling
6. Shopify — commerce platform
7. Notion — JS-heavy workspace SaaS
8. Figma — design platform
9. DIGICO — Malta local B2B
10. Ta' Pawla — Malta local restaurant
11. Square Malta — local multi-location restaurant
12. GitHub Docs — documentation/control class

For each live site, record at minimum:

- acquisition success and retrieval mode;
- canonical identity;
- business description/category/sector where grounded;
- products/services/offers;
- audience evidence;
- positioning evidence;
- topics;
- geography when applicable;
- explicit boundaries if present;
- contacts/social/developer links;
- warnings/noise findings;
- exact provenance;
- per-DNA-group coverage;
- resulting readiness gaps;
- Brand Intelligence contribution before and after user/multi-source confirmation.

## Exit criteria for Flow 1A

Flow 1A is certifiable only when:

1. deterministic extraction tests pass;
2. all real-site cases are fetchable or truthfully classified unavailable;
3. all required live cases score >=90%;
4. average live extraction score is >=95%;
5. identity, offerings, applicable geography, provenance and noise-precision gates all pass;
6. positioning is represented as a first-class Brand-DNA output;
7. unsupported audience/boundary/goal fields remain gaps instead of fabricated values;
8. a Kairo-compatible readiness adapter can convert website evidence to canonical Brand Brain field keys;
9. adding website evidence can be shown to change the Brand Intelligence score deterministically;
10. no confirmed user field can be overwritten by a website refresh.

# Flow 1A — Public Website Onboarding Certification

## Scope

Public HTTP(S) websites only. Social authentication, social scraping, publishing, Hunter, content generation and learner behavior are out of scope.

## Pipeline under test

`URL -> bounded fetch -> page parsing -> same-site crawl -> normalized evidence -> grounded Brand Brain candidate -> provenance/confidence -> Brand-DNA mapping -> readiness contribution`

The canonical Brand-DNA acceptance matrix is documented in `docs/BI-DNA-WEBSITE-TEST-CASES.md`.

## Live matrix

The live suite covers:

- large SaaS / financial platform
- blocked / JS-heavy SaaS
- content-heavy SaaS
- multi-product cloud platform
- developer tooling
- commerce platform
- workspace SaaS
- design platform
- local B2B company
- local restaurant
- local multi-location restaurant
- documentation site as a negative/control class

## Per-site extraction gates

Each site is evaluated for:

1. At least one usable page fetched.
2. Expected brand identity recovered.
3. Expected positioning/source terms exist in evidence.
4. A meaningful description is recovered.
5. Exact provenance is attached to identity/description/offerings.
6. At least 500 normalized source-text characters are retained.
7. Expected product/service coverage is recovered when specified.
8. Expected geography is recovered for location-dependent cases.
9. Contact extraction rejects known telemetry/DSN noise.
10. Products/topics reject structural UI/language noise.
11. Crawl warnings remain within the bounded hygiene threshold.

The suite also records page count, retrieval mode, warnings, text size, links, JSON-LD count, categories, products/services, audiences, locations, topics, contact emails and social/developer links.

## Brand-DNA compatibility gates

Website extraction is not considered Brand-Brain ready merely because the crawl passes.

Before Flow 1A is frozen, website evidence must support canonical mapping for:

- business identity: description/category/sector/subsector;
- offerings: products/services/offers;
- audience when explicitly supported;
- positioning: value proposition/differentiation/market position;
- content topics;
- geography when applicable;
- explicit boundaries/claims only when directly supported.

Unsupported audience, positioning, boundaries, goals or geography must remain explicit gaps. The extractor must never fabricate those fields to raise readiness.

A website-generated Brand Brain field is inferred source evidence. User-confirmed values remain authoritative and cannot be overwritten by a later website refresh.

## Hard certification gate

Flow 1A passes only when:

- all required live sites are fetchable, or are truthfully classified unavailable with grounded reason;
- every required live case scores >=90%;
- average score is >=95%;
- expected identity, offerings, applicable geography, contact precision and exact-provenance gates all pass;
- positioning is exposed as a first-class Brand-DNA output;
- a Kairo-compatible readiness adapter maps website evidence into canonical field keys;
- deterministic tests demonstrate that readiness/BI contribution changes correctly without manufacturing missing DNA;
- confirmed user fields survive refresh unchanged.

A failed live site is not hidden or replaced. The result remains a failure until the adapter/extractor is improved or the source is explicitly classified as unavailable with a grounded reason.

## Safety / integration compatibility

- bounded page count and response size;
- request timeout;
- HTTP(S) only;
- localhost/private destinations rejected;
- production integration must use complete DNS/IP SSRF protection;
- no LLM completion in the deterministic extraction path;
- no inferred structured facts when supporting evidence is absent;
- every Brand Brain field carries state, confidence and provenance;
- dependencies are exact-version pinned in `package.json`;
- production import remains subject to Kairo observability, PES slice gates and exact-SHA certification.

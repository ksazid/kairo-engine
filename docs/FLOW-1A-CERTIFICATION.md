# Flow 1A — Public Website Onboarding Certification

## Scope

Public HTTP(S) websites only. Social authentication, social scraping, publishing, Hunter, content generation and learner behavior are out of scope.

## Pipeline under test

`URL -> bounded fetch -> page parsing -> same-site crawl -> normalized evidence -> grounded Brand Brain candidate -> provenance/confidence`

## Live matrix

The live suite covers:

- large SaaS / financial platform
- JS-heavy SaaS
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

## Per-site gates

Each site is evaluated for:

1. At least one usable page fetched.
2. Expected brand identity recovered.
3. Expected positioning terms exist in source evidence.
4. A meaningful description is recovered.
5. Provenance is attached to extracted identity/description.
6. At least 500 normalized source-text characters are retained.

The suite also records page count, warnings, text size, links, JSON-LD count, categories, products/services, audiences, locations, topics, contact emails and social links.

## Certification gate

Flow 1A passes only when:

- all live sites are fetchable;
- at least 80% of sites score >=80%; and
- average score is >=85%.

A failed live site is not hidden or replaced. The result is a failure until the adapter/extractor is improved or the source is explicitly classified as unavailable with a grounded reason.

## Safety / integration compatibility

- bounded page count and response size;
- request timeout;
- HTTP(S) only;
- obvious localhost/private destinations rejected;
- no LLM completion in the extraction path;
- no inferred structured facts when structured evidence is absent;
- every Brand Brain field carries state, confidence and provenance;
- dependencies are exact-version pinned in `package.json`.

Before importing this code into Kairo, the production adapter must additionally use Kairo's complete DNS/IP SSRF protection, governed dependency/action pinning, observability, PES slice gates and exact-SHA certification.

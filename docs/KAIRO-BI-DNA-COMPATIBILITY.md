# Kairo BI / Brand-DNA Compatibility Contract

## Purpose

This document locks Flow 1A website onboarding to the current Kairo Brand-DNA readiness contract so `kairo-engine` can later replace backend behavior without changing Brand Intelligence semantics.

Verified against `ksazid/kairo` `main` `packages/domain/src/brand-dna-readiness.ts` on 2026-09-01.

## Canonical readiness groups

| Group | Canonical Kairo field keys | Website responsibility |
|---|---|---|
| Business | `identity.description`, `identity.category`, `identity.sector`, `identity.subsector` | Required when publicly grounded |
| Offerings | `identity.products-services`, `identity.offers` | Required when publicly grounded |
| Audience | `audience.primary` | Best effort; only explicit/strongly grounded audience language |
| Positioning | `positioning.value-proposition`, `positioning.differentiation`, `positioning.market-position` | Required when publicly grounded |
| Topics | `content.core-topics`, `content.preferred-topics`, `content.pillars`, `content.related-topics` | Required when repeated source evidence supports them |
| Boundaries | `boundaries.excluded-topics`, `boundaries.prohibited-subjects`, `boundaries.claims-to-avoid` | Conservative only; absence must remain a gap |
| Geography | `identity.geography` | Required only for location-dependent businesses |

## Kairo scoring semantics

Kairo readiness is group-based, not field-count based.

- Base readiness score: percentage of readiness groups with at least one usable field.
- Geography is included only when the business is location-dependent.
- Evidence coverage: percentage of usable readiness fields carrying source evidence.
- Confidence: percentage of usable readiness fields in `confirmed` state.
- Brand Intelligence score: `round(readinessScore * 0.60 + evidenceCoverage * 0.25 + confidence * 0.15)`.

A website-derived field is **inferred**, even when the underlying page evidence is high-confidence. Therefore a website can materially improve BI while still requiring owner confirmation and/or independent sources.

## State compatibility

`kairo-engine` must preserve these semantics:

- `inferred`: extracted/derived from public evidence.
- `confirmed`: explicitly owner/user-confirmed; authoritative over later inferred refreshes.
- `unknown`: unsupported or missing; must not be filled with placeholder prose.
- `conflicting`: independent evidence disagrees and requires resolution.

Website refreshes may update inferred fields. They must never overwrite confirmed fields.

## Current Flow 1A coverage

| Requirement | Current engine status | Certification expectation |
|---|---|---|
| Business identity | Implemented | Brand/description/category must be grounded |
| Products/services | Implemented | Concrete offerings, no navigation/UI noise |
| Audience | Implemented as evidence candidate | Missing audience must remain a gap |
| Positioning | Value-proposition mapping implemented | Must not promote generic slogans/policy text |
| Topics | Implemented | Repeated grounded themes only |
| Geography | Implemented | Required for local/location-dependent cases |
| Boundaries | Intentionally conservative | Missing explicit boundaries remain a gap |
| Evidence provenance | Implemented | Exact page URL + evidence text required |
| Owner-confirmed protection | Implemented | Website refresh cannot overwrite confirmed values |
| BI/readiness contribution | Implemented | Must mirror Kairo weighting deterministically |

### Deliberately not claimed as complete from a website alone

The current extractor does not manufacture `identity.offers`, `identity.sector`, `identity.subsector`, `positioning.differentiation`, `positioning.market-position`, or boundary fields when the website does not provide defensible evidence. A readiness group is satisfied when at least one canonical field in that group is usable, matching Kairo's current evaluator.

Broader Brand DNA such as goals, owner intent, preferred creative direction, explicit content boundaries, and confirmed voice rules should be supplied by owner confirmation or additional evidence sources rather than inferred merely to raise BI.

## Required test layers

1. **Deterministic unit/regression tests** — source fixtures, extraction precision, provenance and merge semantics.
2. **BI contract tests** — canonical field mapping, readiness gaps, geography conditionality, score calculation and confirmed-field protection.
3. **Adversarial website tests** — auth walls, malformed JSON-LD, telemetry strings, UI/navigation noise, language labels, third-party structured data and sparse pages.
4. **Live multi-site certification** — diverse SaaS, JS-heavy, content-heavy, multi-product, developer, commerce, local B2B, restaurant, multi-location and documentation/control sites.
5. **Refresh/merge tests** — same source changes, second independent source agreement, conflicting evidence and user-confirmed precedence.

The detailed acceptance inventory is `docs/BI-DNA-WEBSITE-TEST-CASES.md` (WD-001 through WD-090).

## Flow 1A exit rule

Flow 1A is not frozen until:

- deterministic tests pass;
- all required live sources are either usable or truthfully classified unavailable;
- every required live case scores at least 90%;
- live average is at least 95%;
- identity, offerings, applicable geography, noise precision and exact provenance gates pass;
- BI/DNA semantic gates pass;
- unsupported fields remain gaps;
- user-confirmed values survive refresh unchanged.

Passing HTTP retrieval alone is not certification.

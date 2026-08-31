export type EvidenceState = "confirmed" | "inferred" | "unknown" | "conflicting";

export interface Provenance {
  sourceUrl: string;
  pageUrl: string;
  retrievedAt: string;
  selector?: string;
  evidenceText?: string;
}

export interface EvidenceField<T> {
  value: T;
  state: EvidenceState;
  confidence: number;
  provenance: Provenance[];
}

export interface PageEvidence {
  url: string;
  status: number;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  headings: string[];
  paragraphs: string[];
  links: Array<{ href: string; text: string }>;
  jsonLd: unknown[];
  text: string;
  retrievedAt: string;
}

export interface WebsiteEvidence {
  sourceUrl: string;
  canonicalSourceUrl: string;
  pages: PageEvidence[];
  warnings: string[];
}

export interface BrandBrainCandidate {
  brandName?: EvidenceField<string>;
  description?: EvidenceField<string>;
  categories: EvidenceField<string[]>;
  productsServices: EvidenceField<string[]>;
  audiences: EvidenceField<string[]>;
  locations: EvidenceField<string[]>;
  topics: EvidenceField<string[]>;
  contactEmails: EvidenceField<string[]>;
  socialLinks: EvidenceField<string[]>;
  websiteLinks: EvidenceField<string[]>;
}

export interface CertificationResult {
  inputUrl: string;
  canonicalUrl?: string;
  fetchOk: boolean;
  pagesFetched: number;
  warnings: string[];
  candidate?: BrandBrainCandidate;
  metrics: {
    elapsedMs: number;
    totalTextChars: number;
    totalLinks: number;
    totalJsonLd: number;
  };
}

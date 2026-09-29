export type Decision = {
  id: string;
  title: string;
  rationale: string;
  assumptions: string[];
  reviewCondition: string;
  sourceId: string;
  quote: string;
  anchorId: string;
  version: number;
  status: string;
  createdAt: string;
  history: (Partial<DecisionSnapshot> & {
    version: number;
    at: string;
    status: string;
    effectiveAt?: string;
  })[];
};
export type DecisionSnapshot = Pick<
  Decision,
  "title" | "rationale" | "assumptions" | "reviewCondition" | "sourceId" | "quote" | "version"
>;
export type Source = {
  id: string;
  title: string;
  text: string;
  occurredAt: string;
  importedAt: string;
  origin: string;
  provenance: string;
  projectLabel: string;
  digest: string;
  externalId: string;
  beeVerified: false;
  supersedesSourceId?: string | null;
  sourceRevision?: number;
  provider?: {
    conversationId: number;
    summary: string;
    deviceType: string;
    state: string;
    fetchedAt: string;
    updatedAt: string | null;
    transport: string;
    utterances: { id: number | null; text: string; speaker: string; spokenAt: number | null }[];
  };
};
export type Candidate = {
  decisionSnapshot?: Pick<
    Decision,
    "title" | "rationale" | "assumptions" | "reviewCondition" | "sourceId" | "quote" | "version"
  >;
  retirementReason?: string;
  reviewedAt?: string;
  reopenedDecisionVersion?: number;
  id: string;
  decisionId: string;
  decisionVersion: number;
  sourceId: string;
  quote: string;
  kind: string;
  reason: string;
  status: string;
  manual: boolean;
  createdAt: string;
  reasonForDisposition: string;
  proposal: null | {
    id: string;
    itemId: string;
    itemVersion: number;
    before: string;
    after: string | null;
    status: string;
    approvedAt?: string;
  };
};
export type Project = {
  id: string;
  title: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  decisions: Decision[];
  sources: Source[];
  candidates: Candidate[];
  checklist: { id: string; text: string; done: boolean; version: number }[];
  audit: { id: string; at: string; action: string; detail: string }[];
};
export type Summary = {
  id: string;
  title: string;
  description: string;
  version: number;
  updatedAt: string;
  decisions: number;
  reviews: number;
};
export type User = { id: string; email: string; name: string };

export const sourceOrigin = (source: Source) =>
  source.origin === "bee_api"
    ? "Retrieved from Bee API"
    : source.origin === "bee_fixture"
      ? "Connector test fixture"
      : "Manual import";

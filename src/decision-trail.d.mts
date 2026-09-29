import type { Candidate, Decision } from "./types";
export type TrailContent = Partial<
  Pick<Decision, "title" | "rationale" | "assumptions" | "reviewCondition" | "sourceId" | "quote">
>;
export type TrailNode = {
  version: number;
  content: TrailContent;
  current: boolean;
  recordType: "current" | "archive" | "evidence";
  status: string;
  recordedAt: string;
  complete: boolean;
  previousVersion: number | null;
  reviews: Candidate[];
  outcomes: Candidate[];
  changes: { field: string; before: string | string[]; after: string | string[] }[];
};
export function buildDecisionTrail(decision: Decision, candidates: Candidate[]): TrailNode[];

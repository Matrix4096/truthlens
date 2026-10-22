import type {
  ClaimAnalysis,
  SearchMode,
  SourceItem,
  VerificationResult,
} from "@contracts/types";
import type { LlmConfig } from "./agentgw";

export type RawSource = SourceItem & { content?: string };
export type JobStage = "analyzing" | "searching" | "judging" | "done" | "error";

/** Internal task state. Never serialize this object directly. */
export interface JobState {
  id: string;
  stage: JobStage;
  mode: SearchMode;
  claim: string;
  userId: number | null;
  guestId: string | null;
  analysis?: ClaimAnalysis;
  sources?: RawSource[];
  result?: VerificationResult;
  error?: string;
  createdAt: number;
  llm?: LlmConfig | null;
  ipHash?: string | null;
}

export type JobProgress = Pick<
  JobState,
  "id" | "stage" | "claim" | "analysis" | "result" | "error" | "createdAt"
> & { sources?: SourceItem[] };

/** An allowlist prevents new internal fields, credentials, or fetched bodies escaping. */
export function publicSource(source: SourceItem): SourceItem {
  const {
    id,
    title,
    url,
    siteName,
    date,
    authority,
    snippet,
    stance,
    reliability,
    note,
  } = source;
  return {
    id,
    title,
    url,
    siteName,
    date,
    authority,
    snippet,
    stance,
    reliability,
    note,
  };
}

export function toJobProgress(job: JobState): JobProgress {
  return {
    id: job.id,
    stage: job.stage,
    claim: job.claim,
    analysis: job.analysis,
    sources: job.sources?.map(publicSource),
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
  };
}

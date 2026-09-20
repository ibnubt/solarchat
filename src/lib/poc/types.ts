export type PocStatus = 'success' | 'failed' | 'unsupported' | 'skipped';

export type PocSample = {
  id: string;
  useCase: string;
  scenario: string;
  model: string;
  status: PocStatus;
  startedAt: string;
  httpStatus: number | null;
  ttftMs: number | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  outputTokensPerSecond: number | null;
  finishReason: string | null;
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type PocAggregate = {
  model: string;
  requests: number;
  successful: number;
  failed: number;
  unsupported: number;
  successRate: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  medianTtftMs: number | null;
  medianOutputTokensPerSecond: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  maxSuccessfulInputTokens: number;
  maxSuccessfulConcurrency: number;
  rateLimitOccurrences: number;
};

export type PocUseCaseResult = {
  id: string;
  name: string;
  status: PocStatus | 'partial';
  summary: string;
};

export type PocReport = {
  schemaVersion: 1;
  runId: string;
  profile: string;
  startedAt: string;
  completedAt: string;
  endpoint: string;
  targetModels: string[];
  availableModels: string[];
  methodology: {
    timing: string;
    tokenSource: string;
    percentileNote: string;
    guardrails: string;
  };
  aggregates: PocAggregate[];
  useCases: PocUseCaseResult[];
  findings: string[];
  limitations: string[];
  samples: PocSample[];
};

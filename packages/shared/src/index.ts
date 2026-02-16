export type RecommendationTier = "quick_win" | "deep_refactor";

export interface Hotspot {
  name: string;
  file: string;
  selfTimeMs: number;
  totalTimeMs: number;
  sampleCount: number;
  inclusivePct: number;
  exclusivePct: number;
  rank: number;
}

export interface Recommendation {
  id: string;
  tier: RecommendationTier;
  title: string;
  rationale: string;
  impact: "low" | "medium" | "high";
  effort: "small" | "medium" | "large";
}

export interface FlamegraphAnalysis {
  analysisId: string;
  profileName: string;
  generatedAt: string;
  summary: {
    totalSamples: number;
    profileCount: number;
  };
  hotspots: Hotspot[];
  recommendations: {
    quickWins: Recommendation[];
    deepRefactors: Recommendation[];
  };
}

export const API_ROUTES = {
  analyze: "/api/analyze"
} as const;

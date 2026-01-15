import type { AdoptionScope } from "./adoption.js";
import type { StrategyKey } from "./strategyMetrics.js";

export interface AdoptionMetrics {
  totalAdoptions: number;
  acceptRate: number;
  rejectRate: number;
  rollbackRate: number;
  avgTimeToRollbackMs: number;
  adoptionByScope: Record<AdoptionScope, number>;
  adoptionByStrategyKey: Record<string, number>;
}

export interface ActorMetrics {
  actorId: string;
  totalDecisions: number;
  acceptRate: number;
  rollbackRate: number;
  mostAdoptedViews: string[];
  riskProfile: "conservative" | "aggressive" | "experimental";
}

export interface GovernanceMetrics {
  adoptionMetrics: AdoptionMetrics;
  actorMetrics: ActorMetrics[];
}

export interface GovernancePolicy {
  maxRollbacksPerWindow: number;
  minRunsBeforeAdoption: number;
  restrictedScopes: AdoptionScope[];
  experimentOnlyScopes: AdoptionScope[];
}

export interface GovernanceReport {
  timeWindow: {
    start: string;
    end: string;
  };
  adoptionSummary: AdoptionMetrics;
  rollbackSummary: {
    totalRollbacks: number;
    avgTimeToRollbackMs: number;
  };
  riskyPatterns: string[];
  stabilityCorrelation: Array<{
    strategyKey: StrategyKey;
    stabilityScore: number;
    rollbackRate: number;
  }>;
}

export interface GovernanceViolation {
  id: string;
  policyRule: string;
  actorId: string;
  recommendationId: string;
  strategyKey: StrategyKey;
  reason: string;
  createdAt: string;
}

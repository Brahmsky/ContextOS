import type { AdoptionScope } from "./adoption.js";

export interface GovernancePolicy {
  maxRollbacksPerWindow: number;
  restrictedScopes: AdoptionScope[];
  experimentOnlyScopes: AdoptionScope[];
}

export interface GovernanceReport {
  generatedAt: string;
  totalAdoptions: number;
  acceptRate: number;
  rejectRate: number;
  rollbackRate: number;
  adoptionByScope: Record<AdoptionScope, number>;
  adoptionByStrategyKey: Record<string, number>;
}

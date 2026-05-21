// Phase → retrieval contract binding for the overnight phase runner.
//
// The runner reads `roadmap_phase_overnight_runs.phase_key` and, if it matches
// a Phase 5/6/6b/7 key, injects the bound contract identity + guard rails into
// the AI prompt and validates the response envelope. Phase keys not listed
// here flow through unchanged (backward-compat for phase-1..4).
//
// Guard-rails copy is the operator-guide "Won't do" list — keep both in sync.
// See docs/phases-overnight-operator-guide.md.

import type { RetrievalContractMeta } from "./retrieval-contract.ts";
import { RESOLVER_RETRIEVAL_CONTRACT } from "./retrieval-resolver.ts";
import { INGEST_CONCIERGE_RETRIEVAL_CONTRACT } from "./retrieval-ingest-concierge.ts";
import { VALIDATION_AGENT_RETRIEVAL_CONTRACT } from "./retrieval-validation-agent.ts";
import { CONFLICT_TRIAGE_RETRIEVAL_CONTRACT } from "./retrieval-conflict-triage.ts";

export type PhaseKey = "phase-5" | "phase-6" | "phase-6b" | "phase-7";

export type PhaseContractBinding = {
  phaseKey: PhaseKey;
  contract: RetrievalContractMeta;
  adrs: readonly string[];
  guardrails: readonly string[];
};

export const PHASE_CONTRACTS: Record<PhaseKey, PhaseContractBinding> = {
  "phase-5": {
    phaseKey: "phase-5",
    contract: RESOLVER_RETRIEVAL_CONTRACT,
    adrs: ["ADR-0003", "ADR-0004"],
    guardrails: [
      "never cross tenant_id boundaries",
      "never auto-commit fuzzy alias matches",
      "do not choose tenant-node ancestry storage (ADR-0003 deferred)",
    ],
  },
  "phase-6": {
    phaseKey: "phase-6",
    contract: INGEST_CONCIERGE_RETRIEVAL_CONTRACT,
    adrs: ["ADR-0005", "ADR-0006"],
    guardrails: [
      "never silently overwrite existing canonical_facts",
      "never embed canonical facts (embeddings hint only)",
      "do not run hybrid vector+FTS until ADR-0006 closes",
    ],
  },
  "phase-6b": {
    phaseKey: "phase-6b",
    contract: VALIDATION_AGENT_RETRIEVAL_CONTRACT,
    adrs: [],
    guardrails: [
      "never bypass the 200-row sample cap",
      "never mutate source rows during validation",
    ],
  },
  "phase-7": {
    phaseKey: "phase-7",
    contract: CONFLICT_TRIAGE_RETRIEVAL_CONTRACT,
    adrs: [],
    guardrails: [
      "never edit decision_authorities rules outside git migrations",
      "never auto-resolve rows surfaced by truth_conflicts_unresolved",
    ],
  },
};

export function getPhaseBinding(phaseKey: string | null | undefined): PhaseContractBinding | null {
  if (!phaseKey) return null;
  return (PHASE_CONTRACTS as Record<string, PhaseContractBinding>)[phaseKey] ?? null;
}

/**
 * Cross-check helper used by the runner. Returns null on success or a
 * human-readable reason string on rejection.
 */
export function rejectEnvelope(
  binding: PhaseContractBinding,
  envelope: {
    contract_acknowledged: string;
    guardrails_respected: readonly string[];
  },
): string | null {
  const expected = [
    binding.contract.declaredBy,
    binding.contract.store,
    binding.phaseKey, // pragmatic: phase key proves the binding was seen
  ];
  if (!expected.includes(envelope.contract_acknowledged)) {
    return `contract_acknowledged "${envelope.contract_acknowledged}" does not match declaredBy, store, or phaseKey`;
  }
  const allowed = new Set(binding.guardrails);
  for (const g of envelope.guardrails_respected) {
    if (!allowed.has(g)) return `guardrails_respected entry not in binding: "${g}"`;
  }
  return null;
}


// Zod envelope the overnight-phase-runner expects from the AI for any phase
// bound to a retrieval contract (see phase-contract-map.ts). Schema only —
// the runner cross-checks `contract_acknowledged` + `guardrails_respected`
// against the binding via `rejectEnvelope`.

import { z } from "https://esm.sh/zod@3.23.8";

export const OvernightResponseEnvelopeSchema = z
  .object({
    contract_acknowledged: z.string().min(1),
    guardrails_respected: z.array(z.string().min(1)).min(1),
    would_violate: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1).max(4000),
    risks: z.array(z.string().min(1)).max(10).default([]),
    recommendations: z.array(z.string().min(1)).max(10).default([]),
  })
  .strict();

export type OvernightResponseEnvelope = z.infer<typeof OvernightResponseEnvelopeSchema>;

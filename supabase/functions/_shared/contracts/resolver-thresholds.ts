// Resolver threshold contract — s5.2/t2.
// Operator-only endpoint surface for editing the band cutoffs that the
// resolver uses to decide auto_bind / conflict / no_match. The actual
// scoring lives in `public.resolve_entity`; this contract just governs
// the rules table.
//
// See docs/agents/contract-checklist.md, mem://features/entity-resolver.

import { z } from "https://esm.sh/zod@3.23.8";

export const RESOLVER_BANDS = ["auto_bind", "conflict", "no_match"] as const;
export type ResolverBand = (typeof RESOLVER_BANDS)[number];

export const ThresholdRowSchema = z
  .object({
    band: z.enum(RESOLVER_BANDS),
    min_score: z.number().min(0).max(1),
  })
  .strict();

export const ResolverThresholdsPutSchema = z
  .object({
    thresholds: z.array(ThresholdRowSchema).length(3),
    reason: z.string().min(8).max(500),
  })
  .strict()
  .superRefine((val, ctx) => {
    const byBand = new Map<ResolverBand, number>();
    for (const t of val.thresholds) byBand.set(t.band, t.min_score);
    for (const b of RESOLVER_BANDS) {
      if (!byBand.has(b)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing band ${b}`,
          path: ["thresholds"],
        });
        return;
      }
    }
    const a = byBand.get("auto_bind")!;
    const c = byBand.get("conflict")!;
    const n = byBand.get("no_match")!;
    if (!(a > c && c > n && n >= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "thresholds must be strictly decreasing: auto_bind > conflict > no_match >= 0",
        path: ["thresholds"],
      });
    }
  });

export type ResolverThresholdsPutInput = z.infer<typeof ResolverThresholdsPutSchema>;

export interface ResolverThresholdRow {
  band: ResolverBand;
  min_score: number;
  updated_at: string;
  updated_by: string | null;
}

export interface ResolverThresholdsGetResponse {
  thresholds: ResolverThresholdRow[];
}

export interface ResolverThresholdsPutResponse {
  ok: true;
  previous: ResolverThresholdRow[];
  current: ResolverThresholdRow[];
}

export const RESOLVER_THRESHOLDS_CONTRACT = {
  canonicalQuestion: "What cut-offs separate auto_bind / conflict / no_match for the entity resolver?",
  mandatoryEvidence: ["thresholds", "reason"] as const,
  optionalEvidence: [] as const,
  escalationRule: "non-monotone thresholds → 422; non-operator caller → 403",
  auditTable: "resolver_thresholds_audit",
  truthEntity: "ResolverPolicy",
} as const;

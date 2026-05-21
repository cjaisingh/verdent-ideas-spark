// Phase 5 s5.2 — Entity & Tenant Resolver (weighted scoring + ancestry).
//
// Endpoints (POST):
//   /resolve         — input ResolverRetrievalInput → ResolverRetrievalOutput
//   /bind            — bind a node to a descriptor batch (auto-creates alias)
//   /alias/create    — operator-approved alias create
//
// Scoring (s5.2):
//   authoritative descriptor          → score = weight (1.0 for canonical IDs).
//   alias_exact                       → score = weight * 1.0.
//   alias_fts                         → score = weight * overlap_fraction (max 0.85).
// Weights come from `descriptor_weights` (per-tenant override → zero-UUID default).
// Confidence bands: ≥0.85 auto_bind / 0.55–<0.85 conflict / <0.55 no_match.
// Ancestry is read directly from `tenant_nodes.ancestry_ids` (s5.2 materialised path).
// embedding_hint is deferred to s5.3 (requires tenant-scoped vector store).
// Resolver NEVER crosses tenant_id. All write endpoints require Idempotency-Key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { withLogger } from "../_shared/logger.ts";
import {
  RESOLVER_DESCRIPTOR_KINDS,
  ResolverRetrievalInputSchema,
  type ResolverRetrievalOutput,
} from "../_shared/contracts/retrieval-resolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BindBody = z.object({
  tenantId: z.string().uuid(),
  nodeId: z.string().uuid(),
  descriptors: z
    .array(
      z.object({
        kind: z.enum(RESOLVER_DESCRIPTOR_KINDS),
        value: z.string().min(1),
        authoritative: z.boolean().optional(),
      }),
    )
    .min(1),
});

const AliasCreateBody = z.object({
  tenantId: z.string().uuid(),
  nodeId: z.string().uuid(),
  kind: z.enum(RESOLVER_DESCRIPTOR_KINDS),
  value: z.string().min(1),
  authoritative: z.boolean().optional(),
});

// s5.3 M2 — alias lifecycle
const AliasRevokeBody = z.object({
  tenantId: z.string().uuid(),
  aliasId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  hardRevoke: z.boolean().optional().default(false),
}).strict();

const LifecycleDescriptor = z.object({
  kind: z.enum(RESOLVER_DESCRIPTOR_KINDS),
  value: z.string().min(1),
  authoritative: z.boolean().optional(),
});

const AliasMergeBody = z.object({
  tenantId: z.string().uuid(),
  intoNodeId: z.string().uuid(),
  fromAliasIds: z.array(z.string().uuid()).min(2).max(50),
  descriptor: LifecycleDescriptor,
  reason: z.string().min(1).max(500),
}).strict();

const AliasSplitBody = z.object({
  tenantId: z.string().uuid(),
  sourceAliasId: z.string().uuid(),
  targets: z.array(z.object({
    nodeId: z.string().uuid(),
    descriptor: LifecycleDescriptor,
  })).min(2).max(20),
  reason: z.string().min(1).max(500),
}).strict();


function normalise(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";
const AUTHORITATIVE_KINDS = new Set(["bim_ifc_guid", "rics_id", "os_uprn", "sap_floc"]);

type Kind = typeof RESOLVER_DESCRIPTOR_KINDS[number];
type WeightMap = Partial<Record<Kind, number>>;

type SbClient = ReturnType<typeof createClient>;

async function loadWeights(sb: SbClient, tenantId: string): Promise<WeightMap> {
  const out: WeightMap = {};
  const { data: defaults } = await sb
    .from("descriptor_weights")
    .select("kind, weight")
    .eq("tenant_id", DEFAULT_TENANT);
  for (const r of (defaults ?? []) as Array<{ kind: Kind; weight: number }>) {
    out[r.kind] = Number(r.weight);
  }
  const { data: overrides } = await sb
    .from("descriptor_weights")
    .select("kind, weight")
    .eq("tenant_id", tenantId);
  for (const r of (overrides ?? []) as Array<{ kind: Kind; weight: number }>) {
    out[r.kind] = Number(r.weight);
  }
  return out;
}

function bandFor(score: number): "auto_bind" | "conflict" | "no_match" {
  if (score >= 0.85) return "auto_bind";
  if (score >= 0.55) return "conflict";
  return "no_match";
}

Deno.serve(
  withLogger("entity-resolve", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

    const provided = req.headers.get("x-service-token");
    const auth = req.headers.get("authorization") ?? "";
    const isService = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;

    let actorId: string | null = null;
    let actorLabel = "system";
    let isAdmin = isService; // service token has admin powers
    if (!isService) {
      if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
      const userClient = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false },
      });
      const { data: u, error: ue } = await userClient.auth.getUser();
      if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
      actorId = u.user.id;
      actorLabel = u.user.email ?? "operator";
      const { data: isOp } = await userClient.rpc("has_role", {
        _user_id: actorId,
        _role: "operator",
      });
      const { data: isAd } = await userClient.rpc("has_role", {
        _user_id: actorId,
        _role: "admin",
      });
      if (!isOp && !isAd) return json({ error: "forbidden" }, 403);
      isAdmin = !!isAd;
    }


    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/entity-resolve/, "") || "/resolve";

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    // ----- /resolve ------------------------------------------------------
    if (path === "/resolve" || path === "/" || path === "") {
      const parsed = ResolverRetrievalInputSchema.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const p = parsed.data;
      const topK = p.topK ?? 10;

      const normalisedDescs = p.descriptors.map((d) => ({
        ...d,
        normalised: normalise(d.value),
      }));

      const weights = await loadWeights(sb, p.tenantId);
      const weightFor = (k: Kind) => weights[k] ?? 0.5;

      type Cand = ResolverRetrievalOutput["candidates"][number];
      const byNode = new Map<string, Cand>();
      const addHit = (
        nodeId: string,
        score: number,
        kind: Kind,
        source: Cand["matchSource"],
      ) => {
        const cur = byNode.get(nodeId);
        if (cur) {
          cur.score = Math.max(cur.score, score);
          if (!cur.matchedDescriptors.includes(kind)) cur.matchedDescriptors.push(kind);
          // Upgrade source if stronger.
          const rank: Record<Cand["matchSource"], number> = {
            authoritative: 4,
            alias_exact: 3,
            alias_fts: 2,
            embedding_hint: 1,
          };
          if (rank[source] > rank[cur.matchSource]) cur.matchSource = source;
        } else {
          byNode.set(nodeId, {
            nodeId,
            ancestry: [],
            score,
            matchedDescriptors: [kind],
            matchSource: source,
          });
        }
      };

      // (1) Authoritative — external_ids JSON match on tenant_nodes.
      let authoritativeHit = false;
      const authDescs = normalisedDescs.filter(
        (d) => d.authoritative === true || AUTHORITATIVE_KINDS.has(d.kind),
      );
      for (const d of authDescs) {
        const { data } = await sb
          .from("tenant_nodes")
          .select("id")
          .eq("tenant_id", p.tenantId)
          .contains("external_ids", { [d.kind]: d.value })
          .limit(topK);
        for (const r of (data ?? []) as Array<{ id: string }>) {
          // Authoritative kinds get full weight (1.0 by seed).
          addHit(r.id, weightFor(d.kind as Kind), d.kind as Kind, "authoritative");
          authoritativeHit = true;
        }
      }

      // (2) alias_exact
      if (!authoritativeHit) {
        for (const d of normalisedDescs) {
          const { data } = await sb
            .from("tenant_node_aliases")
            .select("node_id, kind, authoritative")
            .eq("tenant_id", p.tenantId)
            .eq("kind", d.kind)
            .eq("normalised", d.normalised)
            .is("revoked_at", null)
            .limit(topK);
          for (const r of (data ?? []) as Array<{ node_id: string; kind: Kind; authoritative: boolean }>) {
            const w = weightFor(d.kind as Kind);
            if (r.authoritative) {
              addHit(r.node_id, Math.max(w, 0.95), d.kind as Kind, "authoritative");
              authoritativeHit = true;
            } else {
              addHit(r.node_id, w, d.kind as Kind, "alias_exact");
            }
          }
        }
      }

      // (3) alias_fts — Postgres FTS, tenant-scoped
      if (!authoritativeHit && byNode.size < topK) {
        const ftsTerms = normalisedDescs
          .map((d) => d.normalised.split(" ").filter(Boolean).join(" | "))
          .filter(Boolean);
        if (ftsTerms.length) {
          const { data } = await sb
            .from("tenant_node_aliases")
            .select("node_id, kind, normalised")
            .eq("tenant_id", p.tenantId)
            .is("revoked_at", null)
            .textSearch("normalised", ftsTerms.join(" | "), { config: "simple" })
            .limit(topK * 2);
          for (const r of (data ?? []) as Array<{ node_id: string; kind: Kind; normalised: string }>) {
            // overlap_fraction = matched descriptor first-tokens / total descriptors.
            const total = Math.max(1, normalisedDescs.length);
            const overlap = normalisedDescs.filter((d) =>
              (r.normalised ?? "").includes(d.normalised.split(" ")[0]),
            ).length;
            const w = weightFor(r.kind);
            const score = Math.min(0.85, w * (overlap / total));
            addHit(r.node_id, score, r.kind, "alias_fts");
          }
        }
      }

      // Filter to parent (if requested) via materialised ancestry_ids.
      const allIds = Array.from(byNode.keys());
      if (allIds.length) {
        const { data: nodes } = await sb
          .from("tenant_nodes")
          .select("id, ancestry_ids")
          .eq("tenant_id", p.tenantId)
          .in("id", allIds);
        const ancestryMap = new Map(
          ((nodes ?? []) as Array<{ id: string; ancestry_ids: string[] }>).map((n) => [
            n.id,
            n.ancestry_ids ?? [],
          ]),
        );
        for (const c of byNode.values()) {
          c.ancestry = ancestryMap.get(c.nodeId) ?? [c.nodeId];
        }
        if (p.parentNodeId) {
          for (const id of allIds) {
            const anc = ancestryMap.get(id) ?? [];
            if (!anc.includes(p.parentNodeId)) byNode.delete(id);
          }
        }
      }

      const candidates = Array.from(byNode.values()).sort((a, b) => b.score - a.score).slice(
        0,
        topK,
      );

      const topScore = candidates[0]?.score ?? 0;
      const confidenceBand = bandFor(topScore);
      const conflicting = candidates.filter((c) => bandFor(c.score) === "conflict");

      // Emit propose event (best-effort, non-blocking).
      await sb.from("entity_resolution_events").insert({
        tenant_id: p.tenantId,
        kind: "propose",
        actor: actorId,
        actor_label: actorLabel,
        payload: {
          descriptor_count: p.descriptors.length,
          candidate_count: candidates.length,
          authoritative_hit: authoritativeHit,
          confidence_band: confidenceBand,
          top_score: topScore,
        },
      });

      // If two or more candidates land in the conflict band, open a conflict.
      if (!authoritativeHit && conflicting.length >= 2) {
        await sb.from("entity_resolution_events").insert({
          tenant_id: p.tenantId,
          kind: "conflict_open",
          actor: actorId,
          actor_label: actorLabel,
          payload: {
            descriptors: normalisedDescs.map((d) => ({ kind: d.kind, value: d.value })),
            candidate_ids: conflicting.map((c) => c.nodeId),
            confidence_band: "conflict",
          },
        });
      }

      const out: ResolverRetrievalOutput & {
        confidenceBand: "auto_bind" | "conflict" | "no_match";
      } = {
        candidates,
        authoritativeHit,
        confidenceBand,
      };
      return json(out);
    }

    // ----- /alias/create ------------------------------------------------
    if (path === "/alias/create") {
      const idem = req.headers.get("idempotency-key");
      if (!idem) return json({ error: "idempotency_key_required" }, 400);
      const parsed = AliasCreateBody.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const a = parsed.data;

      const norm = normalise(a.value);
      const { data: existing } = await sb
        .from("tenant_node_aliases")
        .select("id, node_id")
        .eq("tenant_id", a.tenantId)
        .eq("kind", a.kind)
        .eq("normalised", norm)
        .is("revoked_at", null)
        .maybeSingle();
      if (existing) {
        if (existing.node_id !== a.nodeId) return json({ error: "alias_conflict", existing }, 409);
        return json({ ok: true, alias_id: existing.id, idempotent: true });
      }

      const { data: ins, error } = await sb
        .from("tenant_node_aliases")
        .insert({
          tenant_id: a.tenantId,
          node_id: a.nodeId,
          kind: a.kind,
          value: a.value,
          source: isService ? "service" : "operator",
          authoritative: a.authoritative ?? false,
          approved_by: actorId,
        })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, alias_id: ins.id });
    }

    // ----- /bind --------------------------------------------------------
    if (path === "/bind") {
      const idem = req.headers.get("idempotency-key");
      if (!idem) return json({ error: "idempotency_key_required" }, 400);
      const parsed = BindBody.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const b = parsed.data;

      const { data: node, error: nodeErr } = await sb
        .from("tenant_nodes")
        .select("id, tenant_id")
        .eq("tenant_id", b.tenantId)
        .eq("id", b.nodeId)
        .maybeSingle();
      if (nodeErr) return json({ error: nodeErr.message }, 500);
      if (!node) return json({ error: "node_not_found" }, 404);

      const created: string[] = [];
      for (const d of b.descriptors) {
        const norm = normalise(d.value);
        const { data: existing } = await sb
          .from("tenant_node_aliases")
          .select("id, node_id")
          .eq("tenant_id", b.tenantId)
          .eq("kind", d.kind)
          .eq("normalised", norm)
          .is("revoked_at", null)
          .maybeSingle();
        if (existing) {
          if (existing.node_id !== b.nodeId) {
            return json({ error: "descriptor_bound_elsewhere", descriptor: d, existing }, 409);
          }
          continue;
        }
        const { data: ins, error } = await sb
          .from("tenant_node_aliases")
          .insert({
            tenant_id: b.tenantId,
            node_id: b.nodeId,
            kind: d.kind,
            value: d.value,
            source: isService ? "service" : "operator",
            authoritative: d.authoritative ?? false,
            approved_by: actorId,
          })
          .select("id")
          .single();
        if (error) return json({ error: error.message }, 500);
        created.push(ins.id);
      }

      await sb.from("entity_resolution_events").insert({
        tenant_id: b.tenantId,
        node_id: b.nodeId,
        kind: "bind",
        actor: actorId,
        actor_label: actorLabel,
        request_id: idem,
        payload: { descriptors: b.descriptors.length, created_alias_ids: created },
      });

      return json({ ok: true, created_alias_ids: created });
    }

    return json({ error: "not_found", path }, 404);
  }),
);

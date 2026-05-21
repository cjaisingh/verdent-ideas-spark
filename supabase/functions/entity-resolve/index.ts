// Phase 5 s5.1 — Entity & Tenant Resolver (deterministic path).
//
// Endpoints (POST):
//   /resolve         — input ResolverRetrievalInput → ResolverRetrievalOutput
//   /bind            — bind a node to a descriptor batch (auto-creates alias)
//   /alias/create    — operator-approved alias create
//
// Match order this sprint: authoritative → alias_exact → alias_fts.
// embedding_hint lands in s5.2. Resolver NEVER crosses tenant_id.
// All write endpoints require Idempotency-Key.
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

function normalise(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
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

    // Authn / authz
    let actorId: string | null = null;
    let actorLabel = "system";
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

      type Cand = ResolverRetrievalOutput["candidates"][number];
      const byNode = new Map<string, Cand>();
      const addHit = (
        nodeId: string,
        score: number,
        kind: typeof RESOLVER_DESCRIPTOR_KINDS[number],
        source: Cand["matchSource"],
      ) => {
        const cur = byNode.get(nodeId);
        if (cur) {
          cur.score = Math.max(cur.score, score);
          if (!cur.matchedDescriptors.includes(kind)) cur.matchedDescriptors.push(kind);
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
        (d) =>
          d.authoritative === true ||
          ["bim_ifc_guid", "rics_id", "os_uprn", "sap_floc"].includes(d.kind),
      );
      for (const d of authDescs) {
        const { data } = await sb
          .from("tenant_nodes")
          .select("id")
          .eq("tenant_id", p.tenantId)
          .contains("external_ids", { [d.kind]: d.value })
          .limit(topK);
        for (const r of data ?? []) {
          addHit(r.id, 1.0, d.kind, "authoritative");
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
          for (const r of data ?? []) {
            if (r.authoritative) {
              addHit(r.node_id, 1.0, d.kind, "authoritative");
              authoritativeHit = true;
            } else {
              addHit(r.node_id, 0.9, d.kind, "alias_exact");
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
          for (const r of data ?? []) {
            // Score proportional to descriptor overlap.
            const overlap = normalisedDescs.filter((d) =>
              (r.normalised ?? "").includes(d.normalised.split(" ")[0]),
            ).length;
            const score = Math.min(0.7, 0.4 + overlap * 0.1);
            addHit(r.node_id, score, r.kind, "alias_fts");
          }
        }
      }

      // Filter to parent (if requested) — load nodes for ancestry chain
      const ids = Array.from(byNode.keys()).slice(0, topK);
      if (ids.length) {
        const { data: nodes } = await sb
          .from("tenant_nodes")
          .select("id, parent_id, tenant_id")
          .eq("tenant_id", p.tenantId)
          .in("id", ids);
        const nodeMap = new Map((nodes ?? []).map((n) => [n.id, n]));
        for (const c of byNode.values()) {
          const chain: string[] = [];
          let cur: { id: string; parent_id: string | null } | undefined = nodeMap.get(c.nodeId);
          let guard = 0;
          while (cur && guard++ < 32) {
            chain.unshift(cur.id);
            if (!cur.parent_id) break;
            // s5.2 will materialise this; for s5.1, one extra fetch per hop.
            const { data: p2 } = await sb
              .from("tenant_nodes")
              .select("id, parent_id")
              .eq("tenant_id", p.tenantId)
              .eq("id", cur.parent_id)
              .maybeSingle();
            cur = p2 ?? undefined;
          }
          c.ancestry = chain;
        }
      }

      const candidates = Array.from(byNode.values()).sort((a, b) => b.score - a.score).slice(
        0,
        topK,
      );

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
        },
      });

      const out: ResolverRetrievalOutput = { candidates, authoritativeHit };
      return json(out);
    }

    // ----- /alias/create ------------------------------------------------
    if (path === "/alias/create") {
      const idem = req.headers.get("idempotency-key");
      if (!idem) return json({ error: "idempotency_key_required" }, 400);
      const parsed = AliasCreateBody.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      const a = parsed.data;

      // Idempotency: if any alias exists with this (tenant,kind,normalised) active, return it.
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

      // Tenant-scoped node existence check.
      const { data: node, error: nodeErr } = await sb
        .from("tenant_nodes")
        .select("id, tenant_id")
        .eq("tenant_id", b.tenantId)
        .eq("id", b.nodeId)
        .maybeSingle();
      if (nodeErr) return json({ error: nodeErr.message }, 500);
      if (!node) return json({ error: "node_not_found" }, 404);

      // For each descriptor: upsert alias (idempotent via unique index).
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

# Rollback runbook — Tier 3 audit migration (2026-06-11)

Covers the migration that fixed issues #20–#23:
- `v_resolver_decisions` view recreated with `confidence_band = 'auto_bind'`.
- `raw_records` unique constraint widened to `(tenant_id, adapter_id, idempotency_key)`.
- `source_mappings` unique constraint widened to `(tenant_id, adapter_id, version)`.
- `ingested_files` gained partial unique index `ingested_files_global_sha256_uk` for null `engagement_id`.

Use only if the change causes a production regression. Order matters — run **pre-checks**, then **rollback**, then **post-checks**.

## 1. Pre-rollback checks (must pass before rollback)

Run in `supabase--read_query`:

```sql
-- a) No tenant pair would collide if we drop tenant_id from raw_records unique
select adapter_id, idempotency_key, count(distinct tenant_id) as tenants
from public.raw_records
group by 1, 2
having count(distinct tenant_id) > 1
limit 5;
-- Expect: 0 rows. If >0, DO NOT ROLLBACK #21 — production data already relies on the wider key.

-- b) Same for source_mappings
select adapter_id, version, count(distinct tenant_id) as tenants
from public.source_mappings
group by 1, 2
having count(distinct tenant_id) > 1
limit 5;
-- Expect: 0 rows. If >0, DO NOT ROLLBACK #22.

-- c) Any null-engagement files relying on the new dedup index?
select sha256, count(*) as dupes
from public.ingested_files
where engagement_id is null
group by 1
having count(*) > 1
limit 5;
-- Expect: 0 rows. If >0, the new index has already prevented duplicates; rolling back #23 reopens that hole.

-- d) Confirm view still reports auto_bind activity (so we know the metric is live)
select day, total, auto_bind_rate
from public.v_resolver_decisions
order by day desc
limit 7;
-- Sanity check before flipping back to the broken view.
```

## 2. Rollback SQL

Run via `supabase--migration` (gates schema change through approval). Comment out blocks you do NOT want to revert.

```sql
-- #20 — revert view to the (broken) 'auto' filter
drop view if exists public.v_resolver_decisions cascade;
create view public.v_resolver_decisions as
with daily as (
  select tenant_id, date_trunc('day', created_at)::date as day,
         confidence_band, match_source, embedding_hint_used, latency_ms
  from public.resolver_decisions
)
select
  tenant_id, day, count(*)::int as total,
  (sum((confidence_band = 'auto')::int)::numeric    / nullif(count(*),0))::numeric(5,4) as auto_bind_rate,
  (sum((confidence_band = 'conflict')::int)::numeric/ nullif(count(*),0))::numeric(5,4) as conflict_rate,
  (sum((confidence_band = 'no_match')::int)::numeric/ nullif(count(*),0))::numeric(5,4) as no_match_rate,
  (sum(embedding_hint_used::int)::numeric           / nullif(count(*),0))::numeric(5,4) as embedding_hint_rate,
  percentile_cont(0.50) within group (order by latency_ms)::int as p50_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms)::int as p95_latency_ms,
  mode() within group (order by match_source) as top_match_source
from daily
group by tenant_id, day;
alter view public.v_resolver_decisions set (security_invoker = on);
grant select on public.v_resolver_decisions to authenticated;

-- #21 — revert raw_records unique
alter table public.raw_records
  drop constraint if exists raw_records_tenant_adapter_ikey_key;
alter table public.raw_records
  add constraint raw_records_adapter_id_idempotency_key_key
  unique (adapter_id, idempotency_key);

-- #22 — revert source_mappings unique
alter table public.source_mappings
  drop constraint if exists source_mappings_tenant_adapter_version_key;
alter table public.source_mappings
  add constraint source_mappings_adapter_id_version_key
  unique (adapter_id, version);

-- #23 — drop the null-engagement dedup index
drop index if exists public.ingested_files_global_sha256_uk;
```

Application-code rollbacks (#24–#27) revert via Lovable chat history — see the **Revert** button on the message that introduced them. No SQL needed.

## 3. Post-rollback verification

```sql
-- Constraints back to original shape
select conname from pg_constraint
where conrelid = 'public.raw_records'::regclass and contype = 'u';
-- Expect: raw_records_adapter_id_idempotency_key_key

select conname from pg_constraint
where conrelid = 'public.source_mappings'::regclass and contype = 'u';
-- Expect: source_mappings_adapter_id_version_key

-- Index removed
select 1 from pg_indexes
where schemaname = 'public' and indexname = 'ingested_files_global_sha256_uk';
-- Expect: 0 rows

-- View definition reverted
select pg_get_viewdef('public.v_resolver_decisions', true) ilike '%confidence_band = ''auto''%' as reverted;
-- Expect: true
```

## 4. Re-apply

If rollback was precautionary and the underlying issue is resolved, re-apply by re-running the original migration `20260611_135114_*` (or the equivalent block from the **2026-06-11 — tier 3 medium/low** CHANGELOG entry). Pre-checks **a/b/c** above must still return 0 rows before re-apply.

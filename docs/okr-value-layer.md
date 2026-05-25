# OKR Value Layer

Anchors AWIP's outcome tracking in USD so any future recommender can rank by impact, not activity.

## Schema

- `public.okr_nodes.projected_value_usd numeric` — operator estimate of what reaching this KR is worth.
- `public.okr_nodes.realized_value_usd numeric` — operator-recorded value once the KR is closed.
- `public.discussion_actions.projected_value_usd numeric` — fallback override for actions not linked to a KR.
- `public.discussion_actions.realized_value_usd numeric` — same, realised side.

All nullable. USD only (multi-currency deferred until a non-USD KR appears).

## Authority rule

KR is canonical. The rollup helper (`src/lib/okrValue.ts → rollupActionValue`) returns KR value whenever the action is linked to a KR; action override is consulted only when `okr_node_id IS NULL`. This prevents double-counting when many actions roll up under one KR.

Values are **operator-authoritative**: AI must not write them without operator approval. The existing `emit_okr_node_event` and `discussion_action_events` triggers capture every change automatically — no new event surface required.

## What this does NOT include

- No Advisor recommender (`do X for +$Y`).
- No UI surfacing on `/okr`, `/roadmap`, or Morning Review yet.
- No backfill of existing KRs — operator fills in as needed.
- No currency column.

## Why it exists

Klarity's Advisor (analysed 2026-05-25) speaks in `+$2.4M Q1`. AWIP's cost side is wired (Credits & Usage, Budget Alerts); the value side was blank. Adding the columns now makes the framing possible later without building the recommender prematurely.

## Related

- ADR-0003 — OKR-driven execution
- `mem://features/okr-value-layer`
- `docs/credits-usage.md` — cost side counterpart

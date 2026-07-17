# doc-lifecycle (W10-S1/S2)

Durable decisions for the corporate-knowledge records layer. See
`docs/specs/w10-corporate-ingestion/` for the full programme.

## Landed — S1 M1 (migration 20260717150000)
- Records identity on `ingested_files`: `records_class`, `retention_policy_key`,
  `revision_of` / `revision_label`, `legal_hold`, `bytes_tier`.
- `retention_policies` seeded: standard / contract / media / working. These seeds
  are the *starting* retention schedule the DPA engagement will ratify.
- `legal_hold` is admin-only via `set_legal_hold()` (SECURITY DEFINER, audited in
  `legal_hold_audit`).
- Classification is deterministic (`_shared/contracts/records-class.ts`), unit-tested.
  LLM assist for the `other` bucket is an operator-toggled follow-up.

## Rules (hold these)
- **A legal hold always beats retention** — the sweeper must never touch a held file.
- **The retention sweeper never deletes rows** — it drops bucket bytes / tiers only
  (hot → chunks_only → tombstone), keeping sha + chunks + events.
- **Trust boundary defaults to `approved`** — retrieval contracts serve approved
  content unless a contract widens `min_approval_state` (S2).

## Not yet landed
- M2: lifecycle enum + approval trust boundary + `document_approval_policies` +
  approval-aware retrieval (`_v2` match RPCs with `min_lifecycle`).
- Retention sweeper (dry-run first, two weeks), storage-quota enforcement,
  revision detection in ingest-file.
- Non-code gates: S1 needs a recorded DR restore drill (incl. held-file
  round-trip); S2 needs an executed DPA (or tenant-zero exception) + the
  operator-absence runbook + review-queue median ≤72h.

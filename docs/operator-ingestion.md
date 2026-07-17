# Operator guide — ingest upload & fact conflicts

The **Ingest Upload** page (`/admin/ingest-upload`) is where an operator brings a
client CSV/XLSX into an engagement, applies an approved source mapping, and
promotes rows into canonical facts.

## Flow

1. **Upload** a file — it lands in the `ingested-files` storage bucket and an
   `ingested_files` row is created.
2. **Pick a mapping** — an approved `source_mappings` row for the file's shape.
3. **Run the adapter** (dry-run first if you want a preview). Each row is
   staged, validated, and then either auto-promoted to `canonical_facts`,
   quarantined (validation failure), or raised as a **fact conflict**.

## Fact conflicts

A conflict is raised when an incoming value validates but **disagrees with the
live canonical fact** for the same `(tenant_node, fact_type, effective_at)`.
Conflicts are never auto-applied — an operator decides. The conflicts table
offers three actions per open row:

| Action | Effect |
|--------|--------|
| **Accept incoming** | Supersedes the live canonical fact with the incoming value. The old fact is retained (marked superseded) for audit; the new one becomes live. |
| **Keep existing** | Leaves the live fact unchanged; the conflict is closed recording that the existing value won. |
| **Dismiss** | Marks the conflict dismissed (e.g. it was noise / not a real disagreement). No fact changes. |

Every resolution is auditable: it writes a `conflict_resolved` event (and, for
an accepted supersede, a `fact_superseded` event) with the acting operator.
Once resolved or dismissed, a row shows its status instead of action buttons.

Resolution is operator-gated (the `resolve_fact_conflict` RPC checks the
`operator` role) and atomic — a failed resolution changes nothing.

# Data Processing Agreement — Template (PLACEHOLDER)

> **Status: PLACEHOLDER — not legally reviewed, not executable.**
>
> This document exists so procurement teams can see the *shape* of a DPA we
> would sign, and so contributors have somewhere to land Tier 2 sovereignty
> work. It is **not** a binding template. Do not send to a customer without
> legal review and without first delivering the Tier 2 commitments referenced
> below (see [`docs/sovereignty.md`](../sovereignty.md#tier-2--contractual-backlog-not-committed)).

---

## 1. Parties

- **Controller:** _[Customer legal entity]_
- **Processor:** _[AWIP Core operating entity — TBD]_
- **Effective date:** _[YYYY-MM-DD]_

## 2. Subject matter & duration

The Processor processes Personal Data on behalf of the Controller solely to
provide the AWIP Core operator console and contract API, for the duration of
the underlying service agreement plus any retention period defined in §7.

## 3. Nature & purpose of processing

- **Nature:** storage, retrieval, indexing, audit logging, AI-assisted
  summarisation and review, operator messaging.
- **Purpose:** running the AWIP Core platform as described in
  [`docs/architecture.md`](../architecture.md).

## 4. Categories of data subjects & data

- **Data subjects:** Controller's operators, end-users referenced in OKRs,
  capability records, notebook entries, or operator messages.
- **Personal data categories:** identifiers (email, user_id), operator-authored
  free text, audit metadata (timestamps, IP, user agent).
- **Special categories:** none expected. Controller must not submit special-
  category data without a separate written addendum.

## 5. Sub-processors

The current sub-processor list is maintained at
[`docs/legal/sub-processor-list.md`](./sub-processor-list.md), generated from
[`docs/sovereignty.md`](../sovereignty.md) §5.

The Controller is deemed to have given general authorisation to the
sub-processors listed at the effective date. The Processor will give
_[NN] days_ written notice (mechanism TBD — Tier 2) before adding or
replacing a sub-processor.

## 6. Location of processing

- **Primary region:** `eu-west-1` (AWS Ireland).
- **Egress:** as listed in [`docs/sovereignty.md`](../sovereignty.md) §4. AI
  prompts and related context leave the EEA today; an in-region AI mode is
  Tier 3 (not committed).

## 7. Retention & deletion

- **Today:** all logs retained indefinitely (see `docs/sovereignty.md` §3).
- **Tier 2 commitment (not yet shipped):** `api_call_logs` 365d,
  `ai_usage_log` 90d, `*_events` retained as audit of record.
- **Deletion endpoint (not yet shipped):** `POST /awip-api/tenants/:id/purge`
  with 30-day tombstone — Tier 2.

## 8. Security measures

The technical and organisational measures are described in
[`docs/security.md`](../security.md) and
[`docs/iso27001-controls.md`](../iso27001-controls.md). Highlights: RLS on
every table, operator-only reads by default, append-only audit streams,
service-token boundary for cross-project writes, idempotency on every write
endpoint.

## 9. Data subject requests

Until the export/delete endpoints land (Tier 2), the Processor will assist
the Controller with data subject requests on a best-effort manual basis
within _[NN]_ business days.

## 10. Breach notification

The Processor will notify the Controller without undue delay and in any case
within _[72 hours]_ of becoming aware of a Personal Data Breach affecting
Controller data, including the information required by Article 33(3) GDPR to
the extent then known.

## 11. Audit

The Controller may request, no more than once per calendar year, a copy of
the most recent third-party audit report (none today; ISO 27001 evidence pack
is Tier 3) or, where unavailable, a written response to a reasonable
security questionnaire.

## 12. International transfers

Where transfers outside the EEA occur (see §6 and the sub-processor list),
the parties rely on the EU Standard Contractual Clauses (Module 2 or 3 as
applicable), incorporated by reference.

## 13. Return or deletion on termination

On termination, the Processor will, at the Controller's election, return or
delete all Personal Data within _[NN]_ days, subject to the deletion
mechanism in §7.

## 14. Liability & order of precedence

This DPA is governed by the underlying service agreement. In the event of
conflict between this DPA and the service agreement on data-protection
matters, this DPA prevails.

---

## Open items before this template can be used

These must be resolved before sending to any customer:

- [ ] Legal review by qualified counsel.
- [ ] Define Processor legal entity (§1).
- [ ] Decide sub-processor change-notice period (§5) and the channel for it.
- [ ] Ship retention policy + deletion endpoint (Tier 2 §7).
- [ ] Ship export endpoint for data subject requests (Tier 2 §9).
- [ ] Decide breach-notification window (§10) — default 72h kept here.
- [ ] Decide audit cadence and evidence (Tier 3 §11).
- [ ] Attach SCCs as an annex (§12).
- [ ] Confirm governing law / jurisdiction in the parent service agreement.

When an item is resolved, update this file and the corresponding section of
[`docs/sovereignty.md`](../sovereignty.md) in the same change.

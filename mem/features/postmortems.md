---
name: postmortems
description: Auto-postmortem on phase/sprint slip — daily cron drafts root_cause + timeline + what_changed into public.postmortems; prose only, no enforcement
type: feature
---
- Table `public.postmortems`: subject_kind ('phase'|'sprint'), subject_id, subject_label, slipped_on, days_late, root_cause, contributing_factors[], timeline[], what_changed, status (draft|reviewed|archived), model. Unique on (kind,id,slipped_on).
- Operator-only RLS via has_role; inserts are service-role only (cron). Realtime on.
- Edge fn `postmortem-generate` (contract in `_shared/contracts/postmortem-generate.ts`): finds slipped sprints (ends_on past, not done/shipped/cancelled) and phases (max child sprint ends_on past). Pulls context: child sprints, sentinel_findings 14d, failed/auto_blocked overnight runs, recent discussion_actions. Lovable AI Gateway with JSON-object response. Idempotent on (kind,id,slipped_on).
- Cron `scheduled-postmortem-generate` daily 06:30 UTC (after morning-review).
- Page `/postmortems` lists drafts/reviewed/all + drawer with prose + "Mark reviewed" + manual "Generate now" button. Realtime subscribed.
- Out of scope: no auto sentinel detector, no discussion_action proposal, no migration drafting.

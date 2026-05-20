---
name: Verify completion
description: Definition-of-done per change type; "deployed" never equals "verified"
type: preference
---

# Verify completion

"Deployed" ≠ "verified." Never claim done from inference. Each change type has a required check.

## Definition of done
- **Edge function edit** → `supabase--test_edge_functions` if a test exists, else `supabase--curl_edge_functions` smoke + `supabase--edge_function_logs` check.
- **Migration** → `supabase--read_query` confirming the new shape; round-trip insert/select where it matters.
- **Detector / sentinel logic** → re-query `sentinel_findings` post-deploy and paste the count.
- **Cron job change** → check `cron.job_run_details` or `automation_runs` after the next tick.
- **UI** → `code--read_console_logs` + `code--read_network_requests` on the affected route, or `code--read_session_replay` for interaction bugs.
- **DB function / trigger** → call it with a synthetic row and assert the side-effect via `supabase--read_query`.

## When no automated check exists
Say so explicitly in the closing sentence and ask the operator to eyeball. Do not silently mark done.

## Persona consultation (binding)
Before planning, cite the relevant persona from `docs/agents/team/` by name:
- contract/API/schema → `awip-core-rules` + `event-engineer`
- sentinel / triage / findings → `sentinel` + `compliance-auditor`
- new cron / edge-fn / agent loop → `contract-first` + `event-engineer`
- doc / foundation change → `product-historian`
- routing logic in Core → `control-plane-operator` (block, push to Control Plane)
- tenant / RLS → `tenant-manager`
- OKR tree → `okr-strategist`
- capability manifest → `capability-architect`

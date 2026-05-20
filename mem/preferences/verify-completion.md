---
name: Verify completion
description: Per-change-type DoD checks + binding persona-consultation map (9 agents in docs/agents/team/)
type: preference
---

"Deployed" ≠ "verified." Never claim done from inference.

## Definition of done
- **Edge fn edit** → `test_edge_functions` if test exists, else `curl_edge_functions` smoke + `edge_function_logs`.
- **Migration** → `read_query` confirming new shape; round-trip insert/select where relevant.
- **Detector/sentinel** → re-query `sentinel_findings` post-deploy; paste count.
- **Cron change** → check `cron.job_run_details` or `automation_runs` after next tick.
- **UI** → `read_console_logs` + `read_network_requests` on affected route; `read_session_replay` for interaction bugs.
- **DB function/trigger** → synthetic-row call + assert side-effect via `read_query`.

If no check exists, say so in the closing sentence; ask operator to eyeball. Do not silently mark done.

## Binding persona map (cite by name before planning)
- contract/API/schema → `awip-core-rules` + `event-engineer`
- sentinel/triage/findings → `sentinel` + `compliance-auditor`
- new cron/edge-fn/agent loop → `contract-first` + `event-engineer`
- doc/foundation change → `product-historian`
- routing logic in Core → `control-plane-operator` (block; push to Control Plane)
- tenant/RLS → `tenant-manager`; OKR tree → `okr-strategist`; capability manifest → `capability-architect`

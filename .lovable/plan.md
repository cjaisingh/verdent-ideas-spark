# End-to-End Test Harness (no Gemini Gems required)

## Why
Real Gem prompts aren't wired yet, so we can't drive the router with live Telegram → LLM classification. We need a way to exercise the full pipeline (inbound message → router → approval_queue → decision → toast/flash/indicator) deterministically.

## Scope
A scripted harness that simulates inbound operator messages and runs them through the existing `route-operator-message` edge function — bypassing any Gem/LLM call — so the rest of the loop (policy match, queue insert, UI realtime, decision flow) can be verified end to end.

## Pieces

### 1. Edge function: `simulate-operator-message`
- Operator-only (verify JWT + `has_role(uid,'operator')`).
- Input: `{ activity, text, intent_payload?, risk?, chat_id?, force_decision? }`.
- Inserts a synthetic `operator_messages` row (direction=`inbound`, raw flagged `simulated:true`).
- Invokes the existing `route-operator-message` logic (extract into a shared handler, or call internally) so the same policy preview / `_policy` trace lands in `approval_queue`.
- Returns the created `approval_queue` row id so the harness can follow it.

### 2. Control-plane UI: "Test harness" panel
- New collapsible card on `/control-plane` (operators only).
- Form: activity dropdown (from `activity_policies`), free-text message, optional JSON payload, risk override.
- Buttons: **Send simulated message**, **Send + auto-approve**, **Send + auto-reject**.
- After send: shows the resulting approval row id + deep link to `/approvals/:id`, and live status (pending → decided) via the existing realtime subscription.
- Clearly labeled "Simulated — does not hit Telegram".

### 3. Quick presets
- 3–4 buttons that fire common scenarios: low-risk auto-approve, high-risk needs-approval, no-policy-match (default action), malformed payload.
- Useful for one-click smoke tests after any change to policies or the router.

### 4. Verification checklist (manual, after harness lands)
- Toast fires on decision ✅
- Pending indicator increments on insert, decrements on decision ✅
- Row flash on decided id ✅
- Policy preview shows matched rule on `/approvals/:id` ✅
- `decided_by` recorded as `ui:<actor>` ✅

## Out of scope (for now)
- Real Gemini Gems / LLM-based classification — tracked separately.
- Telegram outbound echo for simulated messages (skip; would spam the chat).

## Order of work
1. Extract router core into a shared module (`_shared/route.ts`) so both `route-operator-message` and `simulate-operator-message` share it.
2. Implement `simulate-operator-message` edge function.
3. Add Test harness panel to `/control-plane`.
4. Run all four checklist items end to end and report.

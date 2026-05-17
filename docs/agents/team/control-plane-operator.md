---
name: control-plane-operator
description: Owns routing logic. Enforces no routing logic in Core — Control Plane or modules only.
---

# Control Plane Operator

## Role
Defender of Rule 4. Owns the `/control-plane` surface and the future dispatch loop. Bounces any "who acts when" logic that tries to sneak into Core.

## Responsibilities
- Reviews any code that consumes `okr_node_events` or `capability_events` to dispatch work.
- Owns `src/pages/ControlPlane.tsx`, `src/components/control-plane/*`, and the polling cursor logic on `/events/recent`.
- Maintains the contract that Control Plane only calls three endpoints: `/capabilities/demand`, `/capabilities/:id/demand-detail`, `/events/recent`.
- Plans the eventual lift to a separate project — keeps Control Plane code free of Supabase JS direct table reads.

## Key rules
- **Rule 4:** no "who acts when" logic in Core. If a Core file branches on `capability_id`, `kr_id`, or tenant to choose an action, that's a Control Plane concern.
- Control Plane code may only call the contract API — no `supabase.from('okr_nodes')` reads in Control Plane components.
- Polling cursor on `/events/recent` must use the `since=` query param; no client-side filtering of full history.
- Modules dispatch their own work; Control Plane observes and (eventually) routes.

## Questions asked before approving a change
1. Is this branching on capability id, KR id, or tenant to pick an action? If yes — it doesn't belong in Core.
2. Does Control Plane code reach into Supabase tables directly, or does it stay on the contract endpoints?
3. Where does the polling cursor live? Does it survive remount?
4. If you're adding a new contract endpoint for Control Plane, is it read-only? (Writes don't belong here.)
5. Will this code lift cleanly into a separate project — no Core-only imports?

## How to invoke
`Use the control-plane-operator skill before adding routing or dispatch logic.`
Load before: editing `/control-plane`, consuming event streams in the UI, designing a new module's hand-off contract, or any code that resembles `if (capability === 'x') doY()`.

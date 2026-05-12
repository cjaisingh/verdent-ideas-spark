## Goal

Give the operator a clear, confirmed flow on `/connections` to unlink Telegram and relink it, with explicit consequences shown before the destructive step.

## Why deep-link instead of a direct API call

The actual link/unlink happens in Lovable Cloud → Connectors (that's where the workspace-level connection lives and where OAuth/credential entry happens). The app cannot programmatically remove a connection from the runtime, so the in-app flow's job is:
1. Make the consequences obvious before the user leaves the page.
2. Open Cloud → Connectors in a new tab on the right screen.
3. Re-probe on return so the UI reflects reality.

## UX flow

On the Telegram row in `/connections` (and any gateway connector flagged `supports_unlink`), add two new actions next to "Test connection":

- **Unlink** (red ghost button) — opens an `AlertDialog`:
  - Title: "Unlink Telegram?"
  - Body lists what will stop working: Companion alerts, AWIP service notifications, any cron job that posts to Telegram. Pulled from a small static `impact` map keyed by `connector_id`.
  - Shows the env var that will disappear (`TELEGRAM_API_KEY`).
  - Two buttons: "Cancel" and "Open Connectors to unlink" (opens `https://lovable.dev/projects` in a new tab, then sets a local "awaiting unlink" badge on the row).
  - On dialog confirm we also write a row to a new `connection_audit_log` table so we have a record of intent.

- **Relink** (only shown when row is in "Reconnect" / failed state, OR when an "awaiting unlink" badge is set) — opens a similar dialog:
  - Title: "Relink Telegram"
  - Body explains: pick the existing connection in Cloud → Connectors and link it again to this project; credentials don't need to be re-entered if the workspace connection still exists.
  - Buttons: "Cancel" and "Open Connectors to relink".
  - On confirm, log to `connection_audit_log` and start polling `connections-inventory` every 5s for up to 60s; when the row flips to linked + verified, toast "Telegram relinked" and stop polling.

After either dialog, when the tab regains focus we automatically re-run `load()` so the inventory refreshes without a manual click.

## Data

New table `connection_audit_log` (operator-only RLS, insert via the page using the user's JWT):

- `connector_id text not null`
- `env_var_name text not null`
- `action text not null check (action in ('unlink_intent','relink_intent','verified_after_relink'))`
- `actor_user_id uuid not null default auth.uid()`
- `note text`
- `created_at timestamptz not null default now()`

Indexes on `(connector_id, created_at desc)`. RLS: `select`/`insert` only for users with `operator` or `admin` role via existing `has_role()`.

A small "History" disclosure under the Telegram row shows the last 3 audit entries (timestamp + action) so the user can see the trail without leaving the page.

## Files to touch

- `supabase/migrations/<new>.sql` — `connection_audit_log` table + RLS.
- `src/pages/Connections.tsx`:
  - Add `IMPACT` map (Telegram entry only for now; structured so other connectors can be added).
  - Add `UnlinkDialog` and `RelinkDialog` components (use existing `AlertDialog` from `@/components/ui/alert-dialog`).
  - Render the new buttons on rows where `IMPACT[connector_id]` exists.
  - Add `useEffect` that listens for `visibilitychange` to call `load()` on tab refocus.
  - Add the post-relink polling loop and "Telegram relinked" toast.
  - Add the inline "History" disclosure that queries `connection_audit_log`.
- No edge function changes; no change to `connections-inventory`.

## Out of scope

- Programmatic unlink/relink without leaving the app (not supported by the Connectors surface).
- Other connectors — only Telegram gets the `IMPACT` entry now; the structure makes it trivial to add Aikido/Perplexity/etc later.
- Any change to how `TELEGRAM_API_KEY` is consumed by edge functions.
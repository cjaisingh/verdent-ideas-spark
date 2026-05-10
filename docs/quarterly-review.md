# Quarterly Review Checklist

Run on the 1st of January, April, July, and October — the `quarterly-review-open` edge function will open a `discussion_action` linking back to this file. Owner: operator. Target completion: within 14 days of the action being opened.

The goal of this review is to **catch the boring stuff** — config drift, dead code, stale memories, expired secrets — that no per-PR or weekly job will ever surface.

---

## 1. Scaffold configs

Diff against the current Lovable starter template (currently `vite_react_shadcn_ts_2026-04-20`). For every difference:

- If we made the change deliberately (path aliases, plugin order, Tailwind tokens) → keep it.
- If it's a stale upstream default → adopt the new one.

Files in scope:

- `vite.config.ts`
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- `eslint.config.js`
- `postcss.config.js`
- `components.json`
- `tailwind.config.ts` (framework parts only — leave design tokens alone)

## 2. Tailwind tokens vs. component usage

```bash
rg -n "(bg|text|border|ring)-(white|black|gray-|slate-|red-|blue-|green-|yellow-)" src/components src/pages
```

Anything matched is a violation of the "always use semantic tokens" rule in `index.css`. Open a roadmap task per file cluster.

## 3. Major-version Dependabot PRs

Visit **GitHub → Pull requests → label:dependencies** and scan any major bumps Dependabot has been holding back (it's configured to ignore majors). Decide: merge, defer with comment, or close.

## 4. Edge function inventory

```bash
ls supabase/functions/ | grep -v _shared
```

For each function, confirm at least one caller exists (frontend `functions.invoke`, another edge function, cron, or external doc reference). The latest `docs/edge-function-sweep-*.md` has the verdict table — refresh it.

## 5. Cron job inventory

```sql
select jobname, schedule, active from cron.job order by jobname;
```

For each job, ask: "If I disabled this tomorrow, would anything break?" Document any candidates for removal in the review action's notes.

## 6. `mem://` accuracy sweep (light)

Spot-check 3–5 memory files at random. Look for:

- References to deleted code
- "Currently doing X" claims that are no longer true
- Cron schedules that drifted

Full deep audit happens annually, not quarterly.

## 7. ADRs — "still true?"

Skim `docs/adr/*.md`. Mark any superseded ADR with a "Superseded by ADR-N" header. Don't delete ADRs — they're history.

## 8. Secrets rotation

Rotate (≥ every 90 days):

- `AWIP_SERVICE_TOKEN` — coordinated with all calling projects (Rork iPhone app, Discovery AI)
- `GITHUB_REVIEWS_TOKEN` — fine-grained PAT, scope `contents:read` on `verdent-ideas-spark`
- Telegram tokens — via the connector

Do **not** rotate `LOVABLE_API_KEY` from secrets tools — use the dedicated rotate tool.

## 9. Sidebar / nav IA review

Trigger if route count in `src/App.tsx` > 30:

```bash
rg -c "<Route" src/App.tsx
```

Last reorg was 2026-05-10 (5 groups, collapsible subgroups). If we've added > 5 routes since, re-evaluate the grouping.

## 10. RLS coverage

```bash
bun run scripts/rls-coverage-report.ts
```

Confirm 100% of `public.*` tables have RLS enabled and at least one policy. The `security-audit.yml` workflow already enforces this on PRs, but a quarterly human read of the report catches policy *correctness* issues that a count-based check can't.

---

## Closing the review

When done:

1. Update the `discussion_action` to `status=done` with notes summarising findings.
2. If anything required follow-up work, create roadmap tasks (don't bury action items in the review notes).
3. Update this file if the checklist itself needs adjustment — it's a living document.

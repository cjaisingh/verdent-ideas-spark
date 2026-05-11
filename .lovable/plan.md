## Plan: Resolve the remaining GitHub CodeQL error

**What’s actually broken**
The new GitHub error is not from app code, lint, or Bun. The `CodeQL` workflow now completes extraction, but GitHub rejects the uploaded results with:

`CodeQL analyses from advanced configurations cannot be processed when the default setup is enabled`

That means the repository currently has **two conflicting CodeQL systems enabled at the same time**:
- GitHub’s built-in **default setup**
- this repo’s custom **`.github/workflows/codeql.yml` advanced setup**

Only one can be active.

## Recommended fix

**1. Confirm repo security mode**
- Verify that GitHub repository code scanning is still on **default setup**.
- Treat this as the root cause unless the repo state changed after the last run.

**2. Move GitHub to advanced setup**
- Disable CodeQL default setup in the repository’s GitHub security settings so the checked-in `codeql.yml` becomes the only active CodeQL source.
- Keep the repo-managed workflow as the source of truth, since it is versioned and auditable.

**3. Keep the workflow, don’t rewrite it blindly**
- Leave `.github/workflows/codeql.yml` in advanced mode.
- Only make a code change if a second issue appears after default setup is turned off.
- If needed, then update the workflow to `github/codeql-action@v4` in a follow-up pass rather than guessing before the configuration conflict is removed.

**4. Re-run and verify**
- Poll the latest CodeQL run on GitHub after the config switch.
- Confirm the run reaches successful SARIF processing and no longer fails in `Perform CodeQL analysis`.

**5. Jobs board follow-through**
- If the run turns green, allow the existing CI auto-sync to update any linked job rows.
- If it still fails, capture the new concrete error and fix that specific next issue instead of another broad GitHub pass.

## Technical notes
- Evidence from the current failed run (`25678261755`) shows:
  - `Initialize CodeQL`: success
  - extraction/analysis: success
  - upload rejection message: `advanced configurations cannot be processed when the default setup is enabled`
- This is a **GitHub repository configuration conflict**, not a TypeScript/lint/build failure.
- No app or database changes are required unless we choose to add a small doc note about “default vs advanced CodeQL” afterward.

## Expected outcome
- CodeQL stops failing for the current repo configuration reason.
- The remaining GitHub issue becomes either resolved outright or narrowed to a new, much smaller follow-up error.
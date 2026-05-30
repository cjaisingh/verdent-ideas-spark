// Structured diagnostic logger for e2e tests.
//
// Emits one JSON object per line, prefixed with `E2E_DIAG ` so CI workflow
// steps can grep/jq them out of the raw log and surface them in the GitHub
// step summary or as a downloadable artifact.
//
// Shape is stable:
//   {
//     "ts": "<ISO timestamp>",
//     "event": "<short snake_case event id>",
//     "test_file": "<file emitting the diag>",
//     "sqlstate": "<postgres sqlstate or null>",
//     "message": "<error message or null>",
//     "details": "<postgres details or null>",
//     "hint": "<postgres hint or null>",
//     "attempted_row": { ... } | null,
//     "extra": { ... }   // free-form payload, optional
//   }
//
// Keep this file dependency-free so it can be imported from any test.

export interface E2EDiag {
  event: string;
  test_file: string;
  sqlstate?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  attempted_row?: Record<string, unknown> | null;
  extra?: Record<string, unknown>;
}

const PREFIX = "E2E_DIAG ";

export function emitDiag(diag: E2EDiag): void {
  const payload = {
    ts: new Date().toISOString(),
    event: diag.event,
    test_file: diag.test_file,
    sqlstate: diag.sqlstate ?? null,
    message: diag.message ?? null,
    details: diag.details ?? null,
    hint: diag.hint ?? null,
    attempted_row: diag.attempted_row ?? null,
    extra: diag.extra ?? null,
  };
  // Single-line JSON so the CI extractor can rely on one record per line.
  // eslint-disable-next-line no-console
  console.error(PREFIX + JSON.stringify(payload));
}

export const E2E_DIAG_PREFIX = PREFIX;

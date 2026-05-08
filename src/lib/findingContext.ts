// Build a markdown payload for a code-review finding so the operator can
// paste the context into the Lovable chat to discuss it with the agent.
export type FindingForContext = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  category: string | null;
  area: string | null;
  reviewer_model: string;
  reviewed_at: string;
};

export function buildFindingMarkdown(f: FindingForContext, origin: string = window.location.origin): string {
  const link = `${origin}/roadmap/risks#finding-${f.id}`;
  return [
    `# Code-review finding to discuss`,
    ``,
    `- Title: **${f.title}**`,
    `- Severity: \`${f.severity}\``,
    `- Category / Area: ${f.category ?? "—"} / ${f.area ?? "—"}`,
    `- Reviewer model: ${f.reviewer_model}`,
    `- Reviewed at: ${new Date(f.reviewed_at).toLocaleString()}`,
    `- Link: ${link}`,
    ``,
    `## Body`,
    f.body?.trim() ? f.body : "_(no body)_",
    ``,
    `---`,
    `Help me decide: accept_risk, mitigate, convert_to_task, or dismiss — and a one-line rationale.`,
  ].join("\n");
}

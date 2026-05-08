/**
 * Short, mentionable handles for discussions and their parent subjects.
 *
 * - Subject prefix is derived from `subject_type` (e.g. "roadmap_finding" -> "FND").
 * - Findings carry a `short_num` that produces "FND-12".
 * - A discussion handle combines that with the per-subject ordinal: "FND-12-D3".
 */

export const SUBJECT_PREFIX: Record<string, string> = {
  roadmap_finding: "FND",
  roadmap_task: "TASK",
  capability: "CAP",
};

export function subjectPrefix(subjectType: string | null | undefined): string {
  if (!subjectType) return "SUB";
  return SUBJECT_PREFIX[subjectType] ?? subjectType.slice(0, 3).toUpperCase();
}

export function subjectHandle(subjectType: string, shortNum: number | null | undefined): string {
  const p = subjectPrefix(subjectType);
  return shortNum != null ? `${p}-${shortNum}` : p;
}

export function discussionHandle(
  subjectType: string,
  subjectShortNum: number | null | undefined,
  ordinal: number | null | undefined,
): string {
  return `${subjectHandle(subjectType, subjectShortNum)}-D${ordinal ?? "?"}`;
}

export function jobHandle(shortNum: number | null | undefined): string {
  return shortNum != null ? `JOB-${shortNum}` : "JOB-?";
}

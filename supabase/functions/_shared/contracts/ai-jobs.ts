// Typed input contracts for ai_jobs queue (local Ollama worker).
//
// Every job kind has:
//   - an input schema (what the producer must supply)
//   - a system+user prompt builder (what the worker sends to Ollama)
//   - a draft-output projector (how the result becomes an ai_draft_outputs row)
//
// See docs/agents/contract-checklist.md for the rules behind this shape.

import { z } from "https://esm.sh/zod@3.23.8";

// ---- Kinds ---------------------------------------------------------------
export const AI_JOB_KINDS = [
  "draft_changelog_entry",
  "draft_lesson_synthesis",
  "draft_doc_section",
  "codemod_replace_any",
] as const;
export type AiJobKind = typeof AI_JOB_KINDS[number];

// ---- codemod_replace_any --------------------------------------------------
// File-scoped job: ask Ollama to draft sound types for `any` sites in one TS
// file. Output is a unified diff against ts_source. Lands in ai_draft_outputs
// for operator review; gated by lint-delta + CI before merge.
export const CodemodReplaceAnyInput = z.object({
  file_path: z.string().min(1).max(300),
  ts_source: z.string().min(1).max(60000),
  any_sites: z.array(z.object({
    line: z.number().int().min(1),
    col: z.number().int().min(1),
    snippet: z.string().min(1).max(400),
    hint: z.string().max(200).optional(),
  })).min(1).max(40),
  surrounding_types: z.string().max(8000).optional(),
});
export type CodemodReplaceAnyInput = z.infer<typeof CodemodReplaceAnyInput>;

// ---- Schemas -------------------------------------------------------------
export const DraftChangelogEntryInput = z.object({
  date_from: z.string().min(8),
  date_to: z.string().min(8),
  bullets: z.array(z.string().min(1)).min(1).max(80),
  context: z.string().max(2000).optional(),
});
export type DraftChangelogEntryInput = z.infer<typeof DraftChangelogEntryInput>;

export const DraftLessonSynthesisInput = z.object({
  candidate_id: z.string().uuid().optional(),
  title_hint: z.string().min(1).max(200),
  evidence: z.array(z.object({
    source: z.string().min(1),
    snippet: z.string().min(1).max(4000),
  })).min(1).max(20),
  category: z.string().max(80).optional(),
});
export type DraftLessonSynthesisInput = z.infer<typeof DraftLessonSynthesisInput>;

export const DraftDocSectionInput = z.object({
  doc_path: z.string().min(1).max(300),
  section_anchor: z.string().min(1).max(200),
  prompt: z.string().min(1).max(4000),
  existing_md: z.string().max(20000).optional(),
});
export type DraftDocSectionInput = z.infer<typeof DraftDocSectionInput>;

export const AiJobInputByKind = {
  draft_changelog_entry: DraftChangelogEntryInput,
  draft_lesson_synthesis: DraftLessonSynthesisInput,
  draft_doc_section: DraftDocSectionInput,
} as const;

export function validateInput(kind: AiJobKind, input: unknown) {
  const schema = AiJobInputByKind[kind];
  if (!schema) throw new Error(`unknown job kind: ${kind}`);
  return schema.parse(input);
}

// ---- Prompts -------------------------------------------------------------
export type Prompt = { system: string; user: string };

export function buildPrompt(kind: AiJobKind, input: unknown): Prompt {
  switch (kind) {
    case "draft_changelog_entry": {
      const i = DraftChangelogEntryInput.parse(input);
      return {
        system:
          "You write concise CHANGELOG.md entries for an internal platform. " +
          "Output a single markdown block, no preamble. Group related bullets. " +
          "Each bullet is one sentence, past tense, starts with a verb. " +
          "Never invent commits — only use what the user provides.",
        user:
          `Period: ${i.date_from} → ${i.date_to}\n\n` +
          (i.context ? `Context:\n${i.context}\n\n` : "") +
          `Raw bullets:\n${i.bullets.map((b) => `- ${b}`).join("\n")}\n\n` +
          `Produce the markdown changelog block now.`,
      };
    }
    case "draft_lesson_synthesis": {
      const i = DraftLessonSynthesisInput.parse(input);
      return {
        system:
          "You synthesise operator-facing lessons from evidence. " +
          "Output markdown with sections: ## Lesson, ## Why, ## How to apply. " +
          "Keep it under 250 words. Cite no sources inline; the operator links them.",
        user:
          `Working title: ${i.title_hint}\n` +
          (i.category ? `Category: ${i.category}\n` : "") +
          `\nEvidence:\n` +
          i.evidence.map((e, n) => `[${n + 1}] (${e.source})\n${e.snippet}`).join("\n\n") +
          `\n\nProduce the lesson now.`,
      };
    }
    case "draft_doc_section": {
      const i = DraftDocSectionInput.parse(input);
      return {
        system:
          "You draft documentation sections in clean GitHub-flavoured markdown. " +
          "No preamble, no closing remark. Match the surrounding doc's voice if shown.",
        user:
          `Doc: ${i.doc_path}\nSection: ${i.section_anchor}\n\n` +
          (i.existing_md ? `Existing surrounding markdown for tone reference:\n---\n${i.existing_md}\n---\n\n` : "") +
          `Instruction:\n${i.prompt}\n\nProduce the markdown section now.`,
      };
    }
  }
}

// ---- Projector -----------------------------------------------------------
export function projectDraft(kind: AiJobKind, input: unknown, output_text: string) {
  switch (kind) {
    case "draft_changelog_entry": {
      const i = DraftChangelogEntryInput.parse(input);
      return {
        kind,
        target_ref: { file: "CHANGELOG.md", date_from: i.date_from, date_to: i.date_to },
        body_md: output_text.trim(),
      };
    }
    case "draft_lesson_synthesis": {
      const i = DraftLessonSynthesisInput.parse(input);
      return {
        kind,
        target_ref: { candidate_id: i.candidate_id ?? null, title_hint: i.title_hint, category: i.category ?? null },
        body_md: output_text.trim(),
      };
    }
    case "draft_doc_section": {
      const i = DraftDocSectionInput.parse(input);
      return {
        kind,
        target_ref: { doc_path: i.doc_path, section_anchor: i.section_anchor },
        body_md: output_text.trim(),
      };
    }
  }
}

export const AI_JOBS_CONTRACT = {
  kinds: AI_JOB_KINDS,
  defaultModel: "gemma4",
  workerAuth: "x-service-token",
  retryPolicy: { maxAttempts: 3, staleAfterMinutes: 10 },
  reviewSurface: "ai_draft_outputs",
} as const;

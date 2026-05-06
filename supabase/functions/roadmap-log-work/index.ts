// Auto/manual work log endpoint for the roadmap.
// Auth: operator JWT OR x-service-token (AWIP_SERVICE_TOKEN).
// If task_id is omitted, infers the "next up" task from the active phase's first
// non-done sprint, picking the first todo/in_progress task.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-service-token',
};

const BodySchema = z.object({
  task_id: z.string().uuid().optional(),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
  tokens_total: z.number().int().nonnegative().optional(),
  model: z.string().max(100).optional(),
  summary: z.string().max(2000).optional(),
  issues: z.string().max(2000).optional(),
  fixes: z.string().max(2000).optional(),
  author: z.string().max(100).optional(),
  source: z.enum(['manual', 'lovable_agent', 'ai_gateway', 'awip_api']).optional(),
  model_provider: z.string().max(60).optional(),
  prompt_preview: z.string().max(2000).optional(),
  response_preview: z.string().max(2000).optional(),
  request_meta: z.record(z.unknown()).optional(),
  response_meta: z.record(z.unknown()).optional(),
});

const PREVIEW_LEN = 500;
const trim = (s: string | undefined | null) =>
  s ? (s.length > PREVIEW_LEN ? s.slice(0, PREVIEW_LEN) + '…' : s) : null;

function inferProvider(model: string | undefined | null): string | null {
  if (!model) return null;
  if (model.includes('/')) return model.split('/')[0];
  if (/^gpt|^o\d/.test(model)) return 'openai';
  if (/^claude/.test(model)) return 'anthropic';
  if (/^gemini/.test(model)) return 'google';
  return null;
}

// Heuristic extractor for issues/fixes from free-form AI turn output.
// Looks for labeled sections (Issues:, Problems:, Errors:, Fixes:, Resolution:, Solution:)
// followed by bullets / lines, and also "fixed X by Y" / "resolved …" patterns.
function extractIssuesAndFixes(raw: string | null | undefined): { issues: string | null; fixes: string | null } {
  if (!raw) return { issues: null, fixes: null };
  const text = raw.replace(/\r\n/g, '\n');
  const issueLabels = ['issues?', 'problems?', 'errors?', 'bugs?', 'blockers?', 'failures?'];
  const fixLabels = ['fixes?', 'fixed', 'resolutions?', 'resolved', 'solutions?', 'changes?\\s+made'];

  const grabSection = (labels: string[]): string | null => {
    const re = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,6}\\s*|\\*\\*|__)?(?:${labels.join('|')})(?:\\*\\*|__)?\\s*[:\\-–]\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s|\\*\\*[A-Z]|[A-Z][A-Za-z ]{2,30}\\s*[:\\-–]\\s*\\n)|\\n\\s*\\n\\s*\\n|$)`,
      'i',
    );
    const m = text.match(re);
    if (!m) return null;
    const body = m[1]
      .split('\n')
      .map((l) => l.replace(/^\s*[-*•\d.]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .join('\n');
    return body.trim() || null;
  };

  let issues = grabSection(issueLabels);
  let fixes = grabSection(fixLabels);

  // Fallback inline patterns
  if (!fixes) {
    const m = text.match(/\b(?:fixed|resolved|patched)\s+([^.\n]{5,200})/i);
    if (m) fixes = m[0].trim();
  }
  if (!issues) {
    const m = text.match(/\b(?:error|failed|exception|broke|crashed)[^.\n]{5,200}/i);
    if (m) issues = m[0].trim();
  }

  const cap = (s: string | null) => (s && s.length > 1500 ? s.slice(0, 1500) + '…' : s);
  return { issues: cap(issues), fixes: cap(fixes) };
}

async function inferNextUpTaskId(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data: phases } = await supabase
    .from('roadmap_phases').select('id').eq('status', 'active').order('order').limit(1);
  const phase = phases?.[0];
  if (!phase) return null;
  const { data: sprints } = await supabase
    .from('roadmap_sprints').select('id').eq('phase_id', phase.id).neq('status', 'done').order('order');
  const sprintIds = (sprints ?? []).map((s) => s.id);
  if (!sprintIds.length) return null;

  // Prefer the active task (in_progress) anywhere in the active phase.
  const { data: active } = await supabase
    .from('roadmap_tasks')
    .select('id, sprint_id, order')
    .in('sprint_id', sprintIds)
    .eq('status', 'in_progress')
    .order('order')
    .limit(1);
  if (active?.[0]) return active[0].id;

  // Otherwise, first todo in earliest sprint.
  for (const s of sprints ?? []) {
    const { data: tasks } = await supabase
      .from('roadmap_tasks')
      .select('id, order')
      .eq('sprint_id', s.id)
      .eq('status', 'todo')
      .order('order')
      .limit(1);
    if (tasks?.[0]) return tasks[0].id;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // AuthN: service token OR operator JWT
  const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
  const provided = req.headers.get('x-service-token');
  const isService = !!serviceToken && provided === serviceToken;

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  let isOperator = false;
  let userEmail: string | null = null;
  if (!isService && authHeader.startsWith('Bearer ')) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (u?.user) {
      userEmail = u.user.email ?? null;
      const { data: hasRole } = await userClient.rpc('has_role', { _user_id: u.user.id, _role: 'operator' });
      isOperator = !!hasRole;
    }
  }

  if (!isService && !isOperator) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const b = parsed.data;

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Load autolog settings (single-row table). Settings only gate AUTOMATIC sources.
  const { data: settings } = await admin
    .from('roadmap_autolog_settings')
    .select('*').eq('id', true).maybeSingle();
  const isAuto = (b.source ?? (isService ? 'awip_api' : 'manual')) !== 'manual';
  const s = settings ?? {
    enabled: true, capture_tokens: true, capture_duration: true, capture_model: true,
    capture_prompt: true, capture_response: true, capture_request_meta: true,
    capture_response_meta: true, extract_issues_fixes: true,
  };
  if (isAuto && !s.enabled) {
    return new Response(JSON.stringify({ ok: true, skipped: 'autolog_disabled' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const taskId = b.task_id ?? (await inferNextUpTaskId(admin));
  if (!taskId) {
    return new Response(JSON.stringify({ error: 'no_active_task' }), {
      status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const startedAt = b.started_at ?? new Date().toISOString();
  const endedAt = b.ended_at ?? new Date().toISOString();
  const rawDuration = b.duration_ms ?? (new Date(endedAt).getTime() - new Date(startedAt).getTime());
  const duration_ms = isAuto && !s.capture_duration ? null : rawDuration;
  const tokens_in = isAuto && !s.capture_tokens ? null : (b.tokens_in ?? null);
  const tokens_out = isAuto && !s.capture_tokens ? null : (b.tokens_out ?? null);
  const tokens_total = isAuto && !s.capture_tokens
    ? null
    : (b.tokens_total ?? (((b.tokens_in ?? 0) + (b.tokens_out ?? 0)) || null));
  const model = isAuto && !s.capture_model ? null : (b.model ?? null);
  const model_provider = isAuto && !s.capture_model
    ? null
    : (b.model_provider ?? inferProvider(b.model));
  const prompt_preview = isAuto && !s.capture_prompt ? null : trim(b.prompt_preview);
  const response_preview = isAuto && !s.capture_response ? null : trim(b.response_preview);
  const request_meta = isAuto && !s.capture_request_meta ? {} : (b.request_meta ?? {});
  const baseRespMeta = isAuto && !s.capture_response_meta ? {} : (b.response_meta ?? {});

  // Issues/fixes extraction (only if enabled or for manual entries)
  let finalIssues = b.issues ?? null;
  let finalFixes = b.fixes ?? null;
  let autoExtracted = false;
  if (!isAuto || s.extract_issues_fixes) {
    const sourceText = [b.response_preview, b.summary].filter(Boolean).join('\n\n');
    const extracted = extractIssuesAndFixes(sourceText);
    if (!finalIssues && extracted.issues) { finalIssues = extracted.issues; autoExtracted = true; }
    if (!finalFixes && extracted.fixes) { finalFixes = extracted.fixes; autoExtracted = true; }
  }

  const { data, error } = await admin.from('roadmap_work_log').insert({
    task_id: taskId,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms,
    tokens_in,
    tokens_out,
    tokens_total,
    model,
    model_provider,
    summary: b.summary ?? null,
    issues: finalIssues,
    fixes: finalFixes,
    prompt_preview,
    response_preview,
    request_meta,
    response_meta: { ...baseRespMeta, ...(autoExtracted ? { issues_fixes_auto_extracted: true } : {}) },
    author: b.author ?? userEmail ?? (isService ? 'service' : 'operator'),
    source: b.source ?? (isService ? 'awip_api' : 'manual'),
  }).select('id, task_id').single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, log_id: data.id, task_id: data.task_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

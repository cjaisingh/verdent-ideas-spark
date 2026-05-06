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
});

async function inferNextUpTaskId(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data: phases } = await supabase
    .from('roadmap_phases').select('id').eq('status', 'active').order('order').limit(1);
  const phase = phases?.[0];
  if (!phase) return null;
  const { data: sprints } = await supabase
    .from('roadmap_sprints').select('id').eq('phase_id', phase.id).neq('status', 'done').order('order');
  for (const s of sprints ?? []) {
    const { data: tasks } = await supabase
      .from('roadmap_tasks')
      .select('id, status, order')
      .eq('sprint_id', s.id)
      .in('status', ['todo', 'in_progress'])
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

  const taskId = b.task_id ?? (await inferNextUpTaskId(admin));
  if (!taskId) {
    return new Response(JSON.stringify({ error: 'no_active_task' }), {
      status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const startedAt = b.started_at ?? new Date().toISOString();
  const endedAt = b.ended_at ?? new Date().toISOString();
  const duration_ms = b.duration_ms ?? (new Date(endedAt).getTime() - new Date(startedAt).getTime());
  const tokens_total = b.tokens_total ?? ((b.tokens_in ?? 0) + (b.tokens_out ?? 0)) || null;

  const { data, error } = await admin.from('roadmap_work_log').insert({
    task_id: taskId,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms,
    tokens_in: b.tokens_in ?? null,
    tokens_out: b.tokens_out ?? null,
    tokens_total,
    model: b.model ?? null,
    summary: b.summary ?? null,
    issues: b.issues ?? null,
    fixes: b.fixes ?? null,
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

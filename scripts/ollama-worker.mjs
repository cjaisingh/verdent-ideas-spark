#!/usr/bin/env node
// AWIP Core — local Ollama worker.
// Pull-only: polls ai-jobs-claim, runs prompt against Ollama, posts result.
// Zero npm deps; needs Node 18+ for global fetch.
//
// Run:  node --env-file=.env scripts/ollama-worker.mjs
// Docs: docs/ai-jobs-ollama.md

const required = ["SUPABASE_URL", "AWIP_SERVICE_TOKEN", "WORKER_NAME"];
for (const k of required) {
  if (!process.env[k]) { console.error(`missing env: ${k}`); process.exit(1); }
}

const SUPABASE_URL = process.env.SUPABASE_URL.replace(/\/+$/, "");
const TOKEN = process.env.AWIP_SERVICE_TOKEN;
const WORKER = process.env.WORKER_NAME;
const MODEL_TAGS = (process.env.MODEL_TAGS ?? "gemma4").split(",").map(s => s.trim()).filter(Boolean);
const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "gemma4";
const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 20000);
const MAX_JOB_MS = Number(process.env.MAX_JOB_MS ?? 300000);

const log = (...a) => console.log(new Date().toISOString(), "[worker]", ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const fn = (path, body, method = "POST") => fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
  method,
  headers: { "Content-Type": "application/json", "x-service-token": TOKEN },
  body: body == null ? undefined : JSON.stringify(body),
});

async function checkOllama() {
  const r = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!r.ok) throw new Error(`ollama /api/tags ${r.status}`);
  const j = await r.json();
  log(`ollama ok, ${j.models?.length ?? 0} models available`);
}

async function runOllama(model, system, user, signal) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ollama /api/chat ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return {
    text: j.message?.content ?? "",
    tokens_in: j.prompt_eval_count ?? null,
    tokens_out: j.eval_count ?? null,
  };
}

async function claim() {
  const r = await fn("ai-jobs-claim", { worker_name: WORKER, model_tags: MODEL_TAGS });
  if (r.status === 204) return null;
  if (!r.ok) { log(`claim failed ${r.status}: ${(await r.text()).slice(0, 200)}`); return null; }
  const j = await r.json();
  return j.job ?? null;
}

async function heartbeat(jobId) {
  await fn("ai-jobs-heartbeat", { job_id: jobId, worker_name: WORKER }).catch(() => {});
}

async function complete(jobId, payload) {
  const r = await fn("ai-jobs-complete", { job_id: jobId, ...payload });
  if (!r.ok) log(`complete failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function fail(jobId, error) {
  await fn("ai-jobs-fail", { job_id: jobId, error: String(error).slice(0, 1000) }).catch(() => {});
}

async function runJob(job) {
  const model = job.requested_model || DEFAULT_MODEL;
  const sys = job.prompt?.system ?? "";
  const usr = job.prompt?.user ?? "";
  log(`claimed ${job.id} kind=${job.kind} model=${model}`);

  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), MAX_JOB_MS);
  const hb = setInterval(() => heartbeat(job.id), HEARTBEAT_MS);
  const t0 = Date.now();
  try {
    const out = await runOllama(model, sys, usr, ac.signal);
    const latency_ms = Date.now() - t0;
    await complete(job.id, {
      output_text: out.text,
      model,
      tokens_in: out.tokens_in,
      tokens_out: out.tokens_out,
      latency_ms,
    });
    log(`completed ${job.id} in ${latency_ms}ms (${out.tokens_out ?? "?"} out tokens)`);
  } catch (e) {
    log(`failed ${job.id}: ${e?.message ?? e}`);
    await fail(job.id, e?.message ?? e);
  } finally {
    clearInterval(hb);
    clearTimeout(killer);
  }
}

let idleNote = 0;
async function loop() {
  log(`worker "${WORKER}" tags=${MODEL_TAGS.join(",")} → ${SUPABASE_URL}`);
  log(`ollama=${OLLAMA_URL} default_model=${DEFAULT_MODEL}`);
  try { await checkOllama(); }
  catch (e) { log(`ollama check failed: ${e?.message ?? e} — will retry per poll`); }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const job = await claim();
      if (job) { await runJob(job); idleNote = 0; continue; }
      idleNote += POLL_MS;
      if (idleNote >= 60000) { log(`idle (no jobs, 60s)`); idleNote = 0; }
    } catch (e) {
      log(`loop error: ${e?.message ?? e}`);
    }
    await sleep(POLL_MS);
  }
}

process.on("SIGINT", () => { log("SIGINT, exiting"); process.exit(0); });
process.on("SIGTERM", () => { log("SIGTERM, exiting"); process.exit(0); });

loop().catch((e) => { console.error("fatal:", e); process.exit(1); });

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ExternalLink, FileText, MapPin, Database, Send } from "lucide-react";

const TITLE = "Trust & data residency · AWIP Core";
const DESCRIPTION =
  "AWIP Core data lives in eu-west-1 (AWS Ireland). Honest list of egress destinations, sub-processors, and what we deliberately do not yet claim.";

const SOURCE_DOC = "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md";

const SUBPROCESSORS = [
  { name: "Lovable Cloud (Supabase)", purpose: "Database, auth, edge functions, storage", region: "eu-west-1" },
  { name: "Google AI (Gemini)", purpose: "LLM for AI features", region: "Google global" },
  { name: "OpenAI", purpose: "LLM for AI features", region: "OpenAI global" },
  { name: "GitHub", purpose: "Source mirror + CI", region: "GitHub global" },
  { name: "Telegram", purpose: "Operator messaging", region: "Telegram global" },
  { name: "Deepgram", purpose: "Voice transcription (optional)", region: "Deepgram US" },
  { name: "Lovable", purpose: "Hosting + preview environments", region: "Lovable infra" },
];

const EGRESS = [
  { destination: "Google AI (Gemini)", data: "Operator prompts + relevant context" },
  { destination: "OpenAI", data: "Operator prompts + relevant context (when selected)" },
  { destination: "GitHub mirror", data: "Source code + edge function code" },
  { destination: "Telegram", data: "Operator messages routed through the bot" },
  { destination: "Deepgram (US)", data: "Microphone audio + transcripts (when used)" },
];

export default function Trust() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = TITLE;
    const ensureMeta = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", name);
        document.head.appendChild(tag);
      }
      const prev = tag.getAttribute("content");
      tag.setAttribute("content", content);
      return () => {
        if (prev === null) tag?.remove();
        else tag?.setAttribute("content", prev);
      };
    };
    const restoreDesc = ensureMeta("description", DESCRIPTION);
    const restoreRobots = ensureMeta("robots", "index,follow");
    return () => {
      document.title = prevTitle;
      restoreDesc();
      restoreRobots();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container mx-auto max-w-5xl px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <img src="/awip-icon.png" alt="" aria-hidden="true" className="h-6 w-6 rounded-sm" />
            <span className="font-semibold text-foreground">AWIP Core</span>
            <span className="text-muted-foreground">/ trust</span>
          </Link>
          <a
            href={SOURCE_DOC}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Source-of-truth doc <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-10 space-y-10">
        <section className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-3 w-3" />
            Current posture: Tier 1 — Posture only
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Trust</h1>
          <p className="text-lg text-muted-foreground">
            Where your data lives, what leaves the region, and what we deliberately do
            not yet claim. This page is the public summary — the full, honest version
            lives in{" "}
            <a href={SOURCE_DOC} target="_blank" rel="noreferrer" className="underline text-primary">
              docs/sovereignty.md
            </a>
            .
          </p>
          <p className="text-sm text-muted-foreground">
            We are at <strong className="text-foreground">Tier 1 — Posture</strong>.
            That means the architecture supports a sovereignty story but we make{" "}
            <strong className="text-foreground">no contractual or marketed sovereignty claim</strong>.
            Tier 2 (contractual) and Tier 3 (sovereign-grade) are documented backlogs, not commitments.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <MapPin className="h-5 w-5 text-primary" /> Where your data lives
          </h2>
          <ul className="space-y-2 text-sm text-foreground/90">
            <li>
              <strong>Primary region:</strong> <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">eu-west-1</code> (AWS Ireland), via Lovable Cloud.
            </li>
            <li>
              <strong>Replication:</strong> none beyond platform-managed multi-AZ inside <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">eu-west-1</code>. No cross-region replicas.
            </li>
            <li>
              <strong>Backups:</strong> retained inside the same region.
            </li>
            <li>
              <strong>Tenant model:</strong> single Postgres database, isolated by <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">tenant_id</code> + RLS. No per-tenant database, no per-tenant region today.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Send className="h-5 w-5 text-primary" /> What leaves the region
          </h2>
          <p className="text-sm text-muted-foreground">
            We list this honestly rather than handwave. AI calls are the largest sovereignty leak;
            constraining them is a separate workstream and is not in scope for Tier 1.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Destination</th>
                  <th className="px-3 py-2 font-medium">Data class</th>
                </tr>
              </thead>
              <tbody>
                {EGRESS.map((row) => (
                  <tr key={row.destination} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{row.destination}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Everything else — operator UI traffic, database reads/writes, cron jobs, edge functions —
            stays inside <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">eu-west-1</code>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Database className="h-5 w-5 text-primary" /> Sub-processors
          </h2>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Sub-processor</th>
                  <th className="px-3 py-2 font-medium">Purpose</th>
                  <th className="px-3 py-2 font-medium">Region</th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.name} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.purpose}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Mirrors{" "}
            <a
              href="https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/legal/sub-processor-list.md"
              target="_blank"
              rel="noreferrer"
              className="underline text-primary"
            >
              docs/legal/sub-processor-list.md
            </a>
            , which is auto-generated from the sovereignty doc and CI-checked for drift.
          </p>
        </section>

        <section className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="text-base font-semibold text-amber-700 dark:text-amber-300">
            What we do not claim today
          </h2>
          <ul className="grid gap-1 text-sm text-foreground/90 sm:grid-cols-2">
            <li>• In-region AI processing</li>
            <li>• Customer-managed encryption keys (CMK / BYOK)</li>
            <li>• Per-tenant region selection</li>
            <li>• Documented export / delete API</li>
            <li>• Signed audit exports</li>
            <li>• Per-tenant sub-processor opt-in</li>
            <li>• ISO 27001 evidence pack</li>
            <li>• Executed Data Processing Agreement (DPA)</li>
          </ul>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
            Each of these is described in Tier 2 or Tier 3 of the sovereignty doc. They are documented backlog items, not commitments.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Reference documents</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "Sovereignty (full)", href: SOURCE_DOC },
              { label: "Security model", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/security.md" },
              { label: "ISO 27001 controls", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/iso27001-controls.md" },
              { label: "Sub-processor list", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/legal/sub-processor-list.md" },
              { label: "DPA template (placeholder)", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/legal/dpa-template.md" },
              { label: "Architecture", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/architecture.md" },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                {l.label}
                <ExternalLink className="ml-auto h-3 w-3 opacity-60" />
              </a>
            ))}
          </div>
        </section>

        <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
          This page is a public summary. If anything here looks marketed beyond what we ship,
          the source-of-truth is{" "}
          <a href={SOURCE_DOC} target="_blank" rel="noreferrer" className="underline">
            docs/sovereignty.md
          </a>{" "}
          — please raise it.
        </footer>
      </main>
    </div>
  );
}

import { useState } from "react";
import sovereigntyMd from "../../docs/sovereignty.md?raw";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { ShieldCheck, FileText, ExternalLink } from "lucide-react";

type Tier = "Tier 1" | "Tier 2" | "Tier 3";

type FaqItem = {
  q: string;
  a: string;          // markdown-ish; rendered as plain text + inline links
  tier: Tier;
  links: { label: string; href: string }[];
};

// Hand-curated answers. Source of truth for each answer lives in docs/sovereignty.md
// and the docs/legal/ folder. Update both together — see mem://preferences/sovereignty-posture.
const FAQ: FaqItem[] = [
  {
    q: "Where is my data stored?",
    a: "All operator data lives in eu-west-1 (AWS Ireland) via Lovable Cloud. Single region, no cross-region replicas. Backups are managed inside the same region.",
    tier: "Tier 1",
    links: [
      { label: "Sovereignty §1 — Where your data lives", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#1-where-your-data-lives" },
    ],
  },
  {
    q: "Who can read my data?",
    a: "RLS is enabled on every public-schema table. Default is operator-only read; clients cannot write directly. All writes go through the awip-api edge function with a service-role DB client. Roles live in user_roles and are checked via has_role().",
    tier: "Tier 1",
    links: [
      { label: "Security model", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/security.md" },
    ],
  },
  {
    q: "What gets logged?",
    a: "Append-only, operator-readable: api_call_logs, okr_node_events, capability_events, ai_usage_log, telegram_gateway_logs. Retention today is unlimited; a retention policy is on the Tier 2 backlog.",
    tier: "Tier 1",
    links: [
      { label: "Sovereignty §3 — What we record", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#3-what-we-record" },
    ],
  },
  {
    q: "What data leaves the region?",
    a: "Honestly listed: AI prompts + context go to Gemini (Google global) and OpenAI (US-default). Source code is mirrored to GitHub. Operator messages route through Telegram. Voice transcription (when used) goes to Deepgram US. Everything else stays in eu-west-1.",
    tier: "Tier 1",
    links: [
      { label: "Sovereignty §4 — Egress", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#4-what-leaves-the-region-egress-today" },
    ],
  },
  {
    q: "Who are your sub-processors?",
    a: "Lovable Cloud (Supabase), Google AI (Gemini), OpenAI, GitHub, Telegram, Deepgram, Lovable. The auto-generated list is the procurement-friendly artefact; it stays in sync with the sovereignty doc via the doc-drift CI workflow.",
    tier: "Tier 1",
    links: [
      { label: "Sub-processor list", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/legal/sub-processor-list.md" },
      { label: "Sovereignty §5", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#5-sub-processors" },
    ],
  },
  {
    q: "Can I get a Data Processing Agreement (DPA)?",
    a: "There is a placeholder template that lists structure and open items, but it has not been legally reviewed and is not executable. Sending a real DPA to a customer is gated on the Tier 2 commitments below (retention, deletion, sub-processor change notice).",
    tier: "Tier 2",
    links: [
      { label: "DPA template (placeholder)", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/legal/dpa-template.md" },
    ],
  },
  {
    q: "Can I export or delete my tenant's data?",
    a: "Not via a documented API today. Manual best-effort export/delete is possible. A POST /awip-api/tenants/:id/export endpoint and a /purge endpoint with 30-day tombstone are on the Tier 2 backlog.",
    tier: "Tier 2",
    links: [
      { label: "Tier 2 backlog", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#tier-2--contractual-backlog-not-committed" },
    ],
  },
  {
    q: "Can you pin my tenant to a specific region?",
    a: "Not today. The architecture is single-region (eu-west-1) and there is no per-tenant region field. Adding a tenants.region column plus write-time enforcement is part of the Tier 2 backlog and only becomes meaningful when a second region is added.",
    tier: "Tier 2",
    links: [
      { label: "Tier 2 backlog", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#tier-2--contractual-backlog-not-committed" },
    ],
  },
  {
    q: "Can AI calls stay inside my region?",
    a: "Not today. AI egress is the largest sovereignty leak and is treated as a separate workstream. An in-region AI mode (pickModel branch refusing external models for sovereignty=strict tenants) is sketched at Tier 3 but depends on that workstream landing first.",
    tier: "Tier 3",
    links: [
      { label: "Tier 3 — Sovereign-grade", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#tier-3--sovereign-grade-research-only-not-committed" },
    ],
  },
  {
    q: "Do you support customer-managed encryption keys (CMK / BYOK)?",
    a: "No. Everything is platform-encrypted with one key today. CMK / BYOK requires Supabase enterprise tier and is recorded in the Tier 3 research backlog only — not funded.",
    tier: "Tier 3",
    links: [
      { label: "Tier 3 — Sovereign-grade", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#tier-3--sovereign-grade-research-only-not-committed" },
    ],
  },
  {
    q: "Can you provide an ISO 27001 evidence pack?",
    a: "No third-party audit today. We map our controls in docs/iso27001-controls.md as evidence-of-intent. An auto-generated evidence pack from api_call_logs extracts is on the Tier 3 research backlog.",
    tier: "Tier 3",
    links: [
      { label: "ISO 27001 controls map", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/iso27001-controls.md" },
    ],
  },
  {
    q: "Is sovereignty marketed as a USP?",
    a: "No, deliberately. The current tier is Tier 1 — Posture. Three positioning options (USP, one-of-three pillars, posture-only) are recorded as 'not decided' in the sovereignty doc. The decision belongs to whoever talks to the first prospective buyer.",
    tier: "Tier 1",
    links: [
      { label: "Positioning options", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#positioning-not-decided" },
    ],
  },
  {
    q: "How do I report a security or sovereignty concern?",
    a: "Open a discussion action via the Jobs board with risk=high, or escalate via the Morning Review drawer. Operator triage routes will pick it up; if it touches data location or sub-processors, the sovereignty doc must be updated in the same PR.",
    tier: "Tier 1",
    links: [
      { label: "How this doc stays honest", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md#how-to-keep-this-document-honest" },
    ],
  },
];

const TIER_STYLES: Record<Tier, string> = {
  "Tier 1": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  "Tier 2": "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  "Tier 3": "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

const TIER_NOTE: Record<Tier, string> = {
  "Tier 1": "Posture today",
  "Tier 2": "Contractual — backlog, not committed",
  "Tier 3": "Sovereign-grade — research only",
};

export default function Sovereignty() {
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<Tier | "All">("All");

  const filtered = FAQ.filter((item) => {
    const matchesTier = tierFilter === "All" || item.tier === tierFilter;
    if (!matchesTier) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      item.q.toLowerCase().includes(q) ||
      item.a.toLowerCase().includes(q) ||
      item.links.some((l) => l.label.toLowerCase().includes(q))
    );
  });

  const tierCounts = (["Tier 1", "Tier 2", "Tier 3"] as Tier[]).map((t) => ({
    tier: t,
    count: FAQ.filter((f) => f.tier === t).length,
  }));

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold">Data sovereignty</h1>
          <Badge variant="outline" className={TIER_STYLES["Tier 1"]}>
            Current tier: Tier 1 — Posture
          </Badge>
        </div>
        <p className="text-muted-foreground max-w-3xl">
          Buyer-facing FAQ. Every answer here matches the source-of-truth in{" "}
          <a
            href="https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md"
            className="underline text-primary inline-flex items-center gap-1"
            target="_blank"
            rel="noreferrer"
          >
            docs/sovereignty.md <ExternalLink className="h-3 w-3" />
          </a>
          . If something here looks marketed beyond what we actually ship, treat the doc as authoritative and raise it. The public-facing summary lives at <a href="/trust" className="underline text-primary">/trust</a>.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tier legend</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {tierCounts.map(({ tier, count }) => (
            <div key={tier} className="rounded-md border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={TIER_STYLES[tier]}>{tier}</Badge>
                <span className="text-xs text-muted-foreground">{count} answers</span>
              </div>
              <p className="text-sm text-muted-foreground">{TIER_NOTE[tier]}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Frequently asked</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search FAQs (e.g. encryption, region, DPA)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-md"
            />
            <div className="flex flex-wrap gap-1">
              {(["All", "Tier 1", "Tier 2", "Tier 3"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTierFilter(t)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    tierFilter === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted border-input"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} of {FAQ.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No FAQs match. Try a different search or filter.
            </p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {filtered.map((item, idx) => (
                <AccordionItem key={idx} value={`faq-${idx}`}>
                  <AccordionTrigger className="text-left">
                    <div className="flex items-start gap-3 pr-2">
                      <Badge variant="outline" className={`${TIER_STYLES[item.tier]} shrink-0 mt-0.5`}>
                        {item.tier}
                      </Badge>
                      <span className="font-medium">{item.q}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm leading-relaxed text-foreground/90">{item.a}</p>
                    {item.links.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {item.links.map((l, li) => (
                          <a
                            key={li}
                            href={l.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-input bg-muted/50 hover:bg-muted text-foreground"
                          >
                            <FileText className="h-3 w-3" />
                            {l.label}
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </a>
                        ))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reference docs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "Sovereignty (full)", href: "https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/sovereignty.md" },
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
              className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded border border-input hover:bg-muted"
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              {l.label}
              <ExternalLink className="h-3 w-3 opacity-60 ml-auto" />
            </a>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Source word count: {sovereigntyMd.split(/\s+/).length} words in docs/sovereignty.md.
        FAQ entries are hand-curated and must be kept consistent with the source — see{" "}
        <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">
          mem://preferences/sovereignty-posture
        </code>.
      </p>
    </div>
  );
}

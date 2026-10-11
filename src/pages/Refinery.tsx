import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import diagramsMd from "../../docs/knowledge-refinery-diagrams.md?raw";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped W10 tables not yet in generated types */
const db = supabase as any;

type Stage = "raw" | "candidate" | "trusted" | "retired";
interface Bucket { stage: Stage; label: string; table: string; filter?: [string, string, string[]]; count: number | null }

const BUCKETS: Omit<Bucket, "count">[] = [
  { stage: "raw", label: "Raw records", table: "raw_records" },
  { stage: "raw", label: "Files ingested", table: "ingested_files", filter: ["lifecycle", "in", ["ingested"]] },
  { stage: "candidate", label: "Staged records (pending/passed)", table: "staged_records", filter: ["validation_status", "in", ["pending", "passed"]] },
  { stage: "candidate", label: "Files pending review", table: "ingested_files", filter: ["lifecycle", "in", ["pending_review"]] },
  { stage: "candidate", label: "Open fact conflicts", table: "fact_conflicts", filter: ["status", "in", ["open"]] },
  { stage: "trusted", label: "Canonical facts", table: "canonical_facts" },
  { stage: "trusted", label: "Files approved", table: "ingested_files", filter: ["lifecycle", "in", ["approved", "auto_approved"]] },
  { stage: "retired", label: "Quarantined / failed records", table: "staged_records", filter: ["validation_status", "in", ["failed", "quarantined"]] },
  { stage: "retired", label: "Files superseded / archived / rejected", table: "ingested_files", filter: ["lifecycle", "in", ["superseded", "archived", "rejected", "quarantined"]] },
];

const STAGE_META: Record<Stage, { title: string; hint: string }> = {
  raw: { title: "Raw", hint: "Captured as-is, never served" },
  candidate: { title: "Candidate", hint: "Validated, awaiting authority/approval" },
  trusted: { title: "Trusted", hint: "Served by retrieval by default" },
  retired: { title: "Superseded / retired", hint: "Kept for provenance only" },
};

function useBuckets() {
  const [rows, setRows] = useState<Bucket[]>(BUCKETS.map((b) => ({ ...b, count: null })));
  useEffect(() => {
    Promise.all(
      BUCKETS.map(async (b) => {
        let q = db.from(b.table).select("*", { count: "exact", head: true });
        if (b.filter) q = q.in(b.filter[0], b.filter[2]);
        const { count, error } = await q;
        return { ...b, count: error ? null : count ?? 0 };
      }),
    ).then(setRows);
  }, []);
  return rows;
}

function StagesTab() {
  const rows = useBuckets();
  const stages: Stage[] = ["raw", "candidate", "trusted", "retired"];
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {stages.map((s, i) => (
        <Card key={s} className="relative">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              {STAGE_META[s].title}
              {i < 2 && <span className="text-muted-foreground">→</span>}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{STAGE_META[s].hint}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.filter((r) => r.stage === s).map((r) => (
              <div key={r.label} className="flex justify-between text-sm">
                <span>{r.label}</span>
                <Badge variant="secondary">{r.count ?? "—"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProvenanceTab() {
  const [facts, setFacts] = useState<any[]>([]);
  const [term, setTerm] = useState("");
  const [sel, setSel] = useState<any | null>(null);
  const [chain, setChain] = useState<{ staged?: any; raw?: any; conflicts: any[]; events: any[] }>({ conflicts: [], events: [] });

  useEffect(() => {
    db.from("canonical_facts").select("*").order("recorded_at", { ascending: false }).limit(50).then(({ data }: any) => setFacts(data ?? []));
  }, []);

  const shown = useMemo(
    () => facts.filter((f) => !term || JSON.stringify(f).toLowerCase().includes(term.toLowerCase())),
    [facts, term],
  );

  async function open(f: any) {
    setSel(f);
    const staged = f.raw_record_id ? (await db.from("staged_records").select("*").eq("raw_record_id", f.raw_record_id).limit(1).maybeSingle()).data : null;
    const rawId = f.raw_record_id;
    const raw = rawId ? (await db.from("raw_records").select("*").eq("id", rawId).maybeSingle()).data : null;
    const conflicts = (await db.from("fact_conflicts").select("*").or(`existing_canonical_id.eq.${f.id},resolved_canonical_id.eq.${f.id}`).limit(20)).data ?? [];
    const events = (await db.from("ingest_events").select("*").eq("subject_id", f.id).order("recorded_at").limit(50)).data ?? [];
    setChain({ staged, raw, conflicts, events });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Trusted facts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Filter…" value={term} onChange={(e) => setTerm(e.target.value)} />
          {shown.length === 0 && <p className="text-sm text-muted-foreground">No canonical facts yet. Upload via Ingest upload.</p>}
          <div className="max-h-[480px] overflow-auto divide-y">
            {shown.map((f) => (
              <button key={f.id} onClick={() => open(f)} className={`w-full text-left py-2 px-1 text-sm hover:bg-muted ${sel?.id === f.id ? "bg-muted" : ""}`}>
                <div className="font-medium">{f.fact_type}{f.superseded_by ? " · superseded" : ""}</div>
                <div className="text-xs text-muted-foreground truncate">{JSON.stringify(f.value ?? {})}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Provenance chain</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!sel && <p className="text-muted-foreground">Select a fact to trace trusted → candidate → raw.</p>}
          {sel && (
            <>
              <Step label="Trusted" obj={sel} />
              <Step label="Candidate (staged)" obj={chain.staged} />
              <Step label="Raw" obj={chain.raw} />
              <div>
                <div className="font-medium mb-1">Contradictions ({chain.conflicts.length})</div>
                {chain.conflicts.map((c) => <Badge key={c.id} variant="outline" className="mr-1">{c.status}</Badge>)}
              </div>
              <div>
                <div className="font-medium mb-1">Events ({chain.events.length})</div>
                {chain.events.map((e) => (
                  <div key={e.id} className="text-xs text-muted-foreground">{new Date(e.recorded_at).toLocaleString("en-GB")} · {e.event_type}</div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ label, obj }: { label: string; obj: any }) {
  return (
    <div className="border-l-2 border-primary pl-3">
      <div className="font-medium">{label}</div>
      {obj ? (
        <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32">{JSON.stringify(obj, null, 2)}</pre>
      ) : (
        <div className="text-xs text-muted-foreground">Not linked</div>
      )}
    </div>
  );
}

function GatesTab() {
  const [auth, setAuth] = useState<any[]>([]);
  const [appr, setAppr] = useState<any[]>([]);
  const [ret, setRet] = useState<any[]>([]);
  useEffect(() => {
    db.from("decision_authorities").select("*").order("entity").order("precedence").then(({ data }: any) => setAuth(data ?? []));
    db.from("document_approval_policies").select("*").order("records_class").then(({ data }: any) => setAppr(data ?? []));
    db.from("retrieval_contracts").select("*").then(({ data }: any) => setRet(data ?? []));
  }, []);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Authority gate — who wins a contradiction</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Entity</TableHead><TableHead>Field</TableHead><TableHead>Source</TableHead><TableHead>Precedence</TableHead><TableHead>Weight</TableHead><TableHead>Override</TableHead></TableRow></TableHeader>
            <TableBody>
              {auth.map((a) => (
                <TableRow key={a.id}><TableCell>{a.entity}</TableCell><TableCell>{a.field ?? "*"}</TableCell><TableCell>{a.source}</TableCell><TableCell>{a.precedence}</TableCell><TableCell>{a.weight}</TableCell><TableCell>{a.override_policy}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Approval gate — candidate → trusted per document class</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Class</TableHead><TableHead>Mode</TableHead><TableHead>Auto conditions</TableHead></TableRow></TableHeader>
            <TableBody>
              {appr.map((p) => (
                <TableRow key={p.records_class}><TableCell>{p.records_class}</TableCell><TableCell><Badge variant={p.mode === "auto" ? "secondary" : "default"}>{p.mode}</Badge></TableCell><TableCell className="text-xs font-mono">{JSON.stringify(p.auto_conditions ?? {})}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Serving gate — minimum stage each retrieval surface accepts</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Surface</TableHead><TableHead>Min approval</TableHead></TableRow></TableHeader>
            <TableBody>
              {ret.map((r) => (
                <TableRow key={r.id}><TableCell>{r.consumer} <span className="text-xs text-muted-foreground">({r.consumer_kind})</span></TableCell><TableCell><Badge variant="outline">{r.min_approval_state}</Badge></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-2">Enforced: parsed files are stamped by class policy; search filters by this minimum stage.</p>
        </CardContent>
      </Card>
    </div>
  );
}

const NEXT: Record<string, string[]> = {
  ingested: ["pending_review", "quarantined", "rejected"],
  pending_review: ["approved", "rejected", "quarantined"],
  auto_approved: ["approved", "pending_review", "quarantined", "superseded", "archived"],
  approved: ["superseded", "archived", "quarantined"],
  quarantined: ["pending_review", "rejected"],
};
const NEEDS_REASON = new Set(["rejected", "quarantined", "archived"]);

function ReviewTab() {
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () =>
    db.from("ingested_files").select("id,filename,records_class,lifecycle,status,revision_of,legal_hold,updated_at")
      .not("lifecycle", "in", "(rejected,archived,superseded)").order("updated_at", { ascending: false }).limit(100)
      .then(({ data }: any) => setFiles(data ?? []));
  useEffect(() => { load(); }, []);
  async function move(f: any, to: string) {
    let reason: string | null = null;
    if (NEEDS_REASON.has(to)) {
      reason = window.prompt(`Reason for ${to}?`);
      if (!reason) return;
    }
    setBusy(f.id);
    const { error } = await db.rpc("transition_file_lifecycle", { _file_id: f.id, _to: to, _reason: reason });
    setBusy(null);
    if (error) toast.error(error.message); else { toast.success(`${f.filename} → ${to}`); load(); }
  }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Review queue — move files between stages</CardTitle></CardHeader>
      <CardContent>
        {files.length === 0 && <p className="text-sm text-muted-foreground">No files awaiting a decision.</p>}
        <Table>
          <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Class</TableHead><TableHead>Parse</TableHead><TableHead>Stage</TableHead><TableHead>Move to</TableHead></TableRow></TableHeader>
          <TableBody>
            {files.map((f) => (
              <TableRow key={f.id}>
                <TableCell>{f.filename}{f.legal_hold && <Badge variant="destructive" className="ml-2">hold</Badge>}</TableCell>
                <TableCell>{f.records_class}</TableCell>
                <TableCell className="text-xs">{f.status}</TableCell>
                <TableCell><Badge variant="outline">{f.lifecycle}</Badge></TableCell>
                <TableCell className="space-x-1">
                  {(NEXT[f.lifecycle] ?? []).map((to) => (
                    <Button key={to} size="sm" variant={to === "approved" ? "default" : "outline"} disabled={busy === f.id} onClick={() => move(f, to)}>{to.replace("_", " ")}</Button>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-2">Search serves only files meeting each surface's minimum stage (default: approved). Four-eyes classes block self-approval.</p>
      </CardContent>
    </Card>
  );
}

function extractDiagrams(md: string) {
  const out: { title: string; code: string }[] = [];
  const re = /```mermaid\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const before = md.slice(0, m.index);
    const h = [...before.matchAll(/^#{2,3}\s+(.+)$/gm)].pop();
    out.push({ title: h?.[1] ?? `Diagram ${out.length + 1}`, code: m[1] });
  }
  return out;
}

function Mermaid({ code, id }: { code: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    import("mermaid").then(async ({ default: mermaid }) => {
      const dark = document.documentElement.classList.contains("dark");
      mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
      try {
        const { svg } = await mermaid.render(id, code);
        if (alive && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (alive && ref.current) ref.current.textContent = `Diagram failed to render: ${(e as Error).message}`;
      }
    });
    return () => { alive = false; };
  }, [code, id]);
  return <div ref={ref} className="overflow-auto [&_svg]:max-w-full" />;
}

function DiagramsTab() {
  const diagrams = useMemo(() => extractDiagrams(diagramsMd), []);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Rendered live from <code className="font-mono">docs/knowledge-refinery-diagrams.md</code> — edit the doc, this view follows.</p>
      {diagrams.map((d, i) => (
        <Card key={i}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{d.title}</CardTitle></CardHeader>
          <CardContent><Mermaid code={d.code} id={`refinery-d${i}`} /></CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Refinery() {
  const [tab, setTab] = useState("stages");
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge refinery</h1>
          <p className="text-sm text-muted-foreground">Raw → candidate → trusted, with provenance, authority and approval gates (ADR-0013).</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setTab("diagrams")}>View diagrams</Button>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="provenance">Provenance</TabsTrigger>
          <TabsTrigger value="gates">Gates</TabsTrigger>
          <TabsTrigger value="diagrams">Diagrams</TabsTrigger>
        </TabsList>
        <TabsContent value="stages"><StagesTab /></TabsContent>
        <TabsContent value="review"><ReviewTab /></TabsContent>
        <TabsContent value="provenance"><ProvenanceTab /></TabsContent>
        <TabsContent value="gates"><GatesTab /></TabsContent>
        <TabsContent value="diagrams"><DiagramsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BookOpen, Plus, Save, Trash2, GripVertical, ArrowUp, ArrowDown, X, Sparkles } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RUNBOOK_TEMPLATES, type RunbookTemplate } from "@/lib/runbook-templates";
import { toast } from "sonner";

interface Step { title: string; detail?: string }
interface Runbook {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  format: "markdown" | "yaml";
  body: string;
  steps: Step[];
  tags: string[];
  author: string | null;
  created_at: string;
  updated_at: string;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);

const blank = (): Runbook => ({
  id: "",
  slug: "",
  title: "Untitled runbook",
  summary: "",
  format: "markdown",
  body: "## When to use\n\n## Procedure\n\n## Verification\n",
  steps: [],
  tags: [],
  author: null,
  created_at: "",
  updated_at: "",
});

export default function Runbooks() {
  const [list, setList] = useState<Runbook[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Runbook | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("runbooks").select("*").order("updated_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setList((data ?? []) as unknown as Runbook[]);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedId) { setDraft(null); return; }
    const r = list.find((x) => x.id === selectedId);
    if (r) setDraft({ ...r, steps: r.steps ?? [], tags: r.tags ?? [] });
  }, [selectedId, list]);

  const filtered = useMemo(
    () => list.filter((r) =>
      [r.title, r.slug, ...(r.tags ?? [])].join(" ").toLowerCase().includes(filter.toLowerCase())
    ),
    [list, filter]
  );

  const newRunbook = () => {
    const r = blank();
    setSelectedId(null);
    setDraft(r);
  };

  const newFromTemplate = (t: RunbookTemplate) => {
    setSelectedId(null);
    setDraft({
      ...blank(),
      title: t.title,
      slug: slugify(t.id),
      summary: t.summary,
      format: t.format,
      body: t.body,
      steps: t.steps.map((s) => ({ ...s })),
      tags: [...t.tags],
    });
    toast.success(`Loaded template: ${t.title}`);
  };

  const insertTemplateSteps = (t: RunbookTemplate) => {
    if (!draft) return;
    const tags = Array.from(new Set([...(draft.tags ?? []), ...t.tags]));
    setDraft({
      ...draft,
      steps: [...draft.steps, ...t.steps.map((s) => ({ ...s }))],
      tags,
    });
    toast.success(`Inserted ${t.steps.length} steps from "${t.title}"`);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) { toast.error("Title required"); return; }
    setSaving(true);
    const slug = draft.slug || slugify(draft.title);
    const payload = {
      slug, title: draft.title, summary: draft.summary || null,
      format: draft.format, body: draft.body,
      steps: draft.steps as unknown as never, tags: draft.tags,
    };
    if (draft.id) {
      const { error } = await supabase.from("runbooks").update(payload).eq("id", draft.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Saved");
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("runbooks")
        .insert({ ...payload, author: user?.email ?? null }).select().single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Created");
      setSelectedId((data as unknown as Runbook).id);
    }
    setSaving(false);
    await load();
  };

  const remove = async () => {
    if (!draft?.id) return;
    const { error } = await supabase.from("runbooks").delete().eq("id", draft.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    setSelectedId(null);
    setDraft(null);
    await load();
  };

  const updateStep = (i: number, patch: Partial<Step>) => {
    if (!draft) return;
    const steps = [...draft.steps];
    steps[i] = { ...steps[i], ...patch };
    setDraft({ ...draft, steps });
  };
  const addStep = () => draft && setDraft({ ...draft, steps: [...draft.steps, { title: "", detail: "" }] });
  const moveStep = (i: number, dir: -1 | 1) => {
    if (!draft) return;
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({ ...draft, steps });
  };
  const removeStep = (i: number) => draft &&
    setDraft({ ...draft, steps: draft.steps.filter((_, k) => k !== i) });

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || !draft || draft.tags.includes(t)) return;
    setDraft({ ...draft, tags: [...draft.tags, t] });
    setTagInput("");
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="h-6 w-6" /> Runbooks
          </h1>
          <p className="text-sm text-muted-foreground">
            Operator procedures stored as Markdown or YAML with ordered steps.
          </p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Sparkles className="h-4 w-4 mr-2" /> Templates
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Start a new runbook from…</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {RUNBOOK_TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => newFromTemplate(t)}
                  className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-[11px] text-muted-foreground line-clamp-2">{t.summary}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={newRunbook}><Plus className="h-4 w-4 mr-2" /> New</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Library ({filtered.length})</CardTitle>
            <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-2" />
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[70vh]">
              <div className="px-2 pb-2 space-y-1">
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3">No runbooks yet.</p>
                )}
                {filtered.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted ${
                      selectedId === r.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                      <span>{r.slug}</span>
                      <Badge variant="outline" className="h-4 text-[10px]">{r.format}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span>{draft ? (draft.id ? "Edit runbook" : "New runbook") : "Pick a runbook"}</span>
              {draft && (
                <div className="flex gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Sparkles className="h-4 w-4 mr-1" /> Insert template
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuLabel>Append steps from…</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {RUNBOOK_TEMPLATES.map((t) => (
                        <DropdownMenuItem key={t.id} onClick={() => insertTemplateSteps(t)}
                          className="flex flex-col items-start gap-0.5">
                          <span className="font-medium">{t.title}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {t.steps.length} steps · {t.tags.join(", ")}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {draft.id && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <Trash2 className="h-4 w-4 mr-1" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this runbook?</AlertDialogTitle>
                          <AlertDialogDescription>
                            "{draft.title}" will be permanently removed.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  <Button size="sm" onClick={save} disabled={saving}>
                    <Save className="h-4 w-4 mr-1" /> Save
                  </Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!draft ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Pick a runbook on the left or create a new one.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Title</label>
                    <Input value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Slug</label>
                    <Input value={draft.slug} placeholder={slugify(draft.title)}
                      onChange={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Format</label>
                    <Select value={draft.format}
                      onValueChange={(v) => setDraft({ ...draft, format: v as "markdown" | "yaml" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="markdown">Markdown</SelectItem>
                        <SelectItem value="yaml">YAML</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Tags</label>
                    <div className="flex gap-2">
                      <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                        placeholder="add tag…" />
                      <Button variant="outline" size="sm" onClick={addTag}>Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {draft.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="gap-1">
                          {t}
                          <button onClick={() => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}>
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">Summary</label>
                  <Input value={draft.summary ?? ""}
                    onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                    placeholder="One-line description" />
                </div>

                <Tabs defaultValue="body">
                  <TabsList>
                    <TabsTrigger value="body">Body ({draft.format})</TabsTrigger>
                    <TabsTrigger value="steps">Steps ({draft.steps.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="body">
                    <Textarea value={draft.body}
                      onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      className="font-mono text-xs min-h-[420px]"
                      placeholder={draft.format === "yaml" ? "name: ...\nsteps:\n  - run: ..." : "# Runbook\n\n..."} />
                  </TabsContent>
                  <TabsContent value="steps">
                    <div className="space-y-2">
                      {draft.steps.length === 0 && (
                        <p className="text-xs text-muted-foreground">No steps yet — add the first one.</p>
                      )}
                      {draft.steps.map((s, i) => (
                        <div key={i} className="border rounded p-2 space-y-2 bg-muted/30">
                          <div className="flex items-center gap-2">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                            <Badge variant="outline">{i + 1}</Badge>
                            <Input value={s.title}
                              onChange={(e) => updateStep(i, { title: e.target.value })}
                              placeholder="Step title" className="flex-1" />
                            <Button size="icon" variant="ghost" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => moveStep(i, 1)}
                              disabled={i === draft.steps.length - 1}>
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => removeStep(i)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <Textarea value={s.detail ?? ""}
                            onChange={(e) => updateStep(i, { detail: e.target.value })}
                            placeholder="Details / commands / expected output"
                            className="font-mono text-xs min-h-[80px]" />
                        </div>
                      ))}
                      <Button size="sm" variant="outline" onClick={addStep}>
                        <Plus className="h-4 w-4 mr-1" /> Add step
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>

                {draft.id && (
                  <p className="text-[11px] text-muted-foreground">
                    Updated {new Date(draft.updated_at).toLocaleString()} · author {draft.author ?? "—"}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

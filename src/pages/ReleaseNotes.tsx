import { useMemo, useState } from "react";
import sentinelCleanup from "@/content/release-notes/2026-05-16-sentinel-cleanup.md?raw";

type Note = { slug: string; date: string; title: string; body: string };

const NOTES: Note[] = [
  {
    slug: "2026-05-16-sentinel-cleanup",
    date: "2026-05-16",
    title: "Sentinel false-positive cleanup",
    body: sentinelCleanup,
  },
];

/** Tiny markdown renderer — handles h1/h2/h3, lists, bold, inline code, paragraphs. */
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const out: JSX.Element[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;

  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-foreground/90 text-[0.85em]">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>');

  const flushPara = () => {
    if (para.length) {
      const html = inline(para.join(" "));
      out.push(
        <p key={key++} className="text-sm text-foreground/85 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={key++} className="list-disc pl-5 space-y-1 text-sm text-foreground/85">
          {list.map((it, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inline(it) }} />
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (line.startsWith("# ")) { flushPara(); flushList(); out.push(<h1 key={key++} className="text-2xl font-semibold tracking-tight">{line.slice(2)}</h1>); continue; }
    if (line.startsWith("## ")) { flushPara(); flushList(); out.push(<h2 key={key++} className="text-lg font-semibold mt-6 border-b border-border pb-1">{line.slice(3)}</h2>); continue; }
    if (line.startsWith("### ")) { flushPara(); flushList(); out.push(<h3 key={key++} className="text-base font-semibold mt-4">{line.slice(4)}</h3>); continue; }
    if (/^[-*]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-*]\s+/, "")); continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out;
}

export default function ReleaseNotes() {
  const [slug, setSlug] = useState(NOTES[0].slug);
  const active = useMemo(() => NOTES.find((n) => n.slug === slug) ?? NOTES[0], [slug]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Release notes</h1>
        <p className="text-sm text-muted-foreground">Operator-facing summaries of operational fixes and shipped changes.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <aside className="space-y-1">
          {NOTES.map((n) => {
            const isActive = n.slug === active.slug;
            return (
              <button
                key={n.slug}
                onClick={() => setSlug(n.slug)}
                className={`w-full text-left rounded-md px-3 py-2 border transition ${
                  isActive
                    ? "border-primary/40 bg-primary/5"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">{n.date}</div>
                <div className="text-sm font-medium text-foreground">{n.title}</div>
              </button>
            );
          })}
        </aside>

        <article className="rounded-md border border-border bg-card p-6 space-y-3">
          {renderMarkdown(active.body)}
        </article>
      </div>
    </div>
  );
}

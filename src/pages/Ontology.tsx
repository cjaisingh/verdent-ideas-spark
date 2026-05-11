import { useEffect, useMemo, useState } from "react";
import ontologyMd from "../../docs/ontology.md?raw";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Lightweight markdown → HTML renderer (avoids adding a dep).
// Handles: headings, bold, italics, inline code, code fences, lists,
// blockquotes, tables, hr, paragraphs.
function renderMarkdown(md: string): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-xs font-mono">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="underline text-primary">$1</a>');

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let inList = false;
  let inTable = false;
  let tableHeader = false;
  let inBlockquote = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p class="my-3 leading-relaxed">${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table></div>");
      inTable = false;
      tableHeader = false;
    }
  };
  const closeBq = () => {
    if (inBlockquote) {
      out.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (line.startsWith("```")) {
      flushPara();
      closeList();
      closeTable();
      closeBq();
      if (!inFence) {
        out.push('<pre class="my-4 p-3 rounded bg-muted overflow-x-auto text-xs font-mono"><code>');
        inFence = true;
      } else {
        out.push("</code></pre>");
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      out.push(escapeHtml(raw) + "\n");
      continue;
    }

    if (!line.trim()) {
      flushPara();
      closeList();
      closeTable();
      closeBq();
      continue;
    }

    // Headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      closeTable();
      closeBq();
      const lvl = h[1].length;
      const sizes = ["text-3xl", "text-2xl", "text-xl", "text-lg", "text-base", "text-sm"];
      const margins = ["mt-8 mb-4", "mt-8 mb-3", "mt-6 mb-2", "mt-4 mb-2", "mt-3 mb-1", "mt-2 mb-1"];
      out.push(
        `<h${lvl} class="${sizes[lvl - 1]} font-semibold ${margins[lvl - 1]}">${inline(h[2])}</h${lvl}>`
      );
      continue;
    }

    // HR
    if (/^---+$/.test(line)) {
      flushPara();
      closeList();
      closeTable();
      closeBq();
      out.push('<hr class="my-6 border-border" />');
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      flushPara();
      closeList();
      closeTable();
      if (!inBlockquote) {
        out.push('<blockquote class="my-3 pl-4 border-l-2 border-primary/40 text-muted-foreground italic">');
        inBlockquote = true;
      }
      out.push(`<p class="my-1">${inline(line.slice(2))}</p>`);
      continue;
    } else if (inBlockquote) {
      closeBq();
    }

    // Table
    if (line.startsWith("|")) {
      flushPara();
      closeList();
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      const isSep = cells.every((c) => /^:?-+:?$/.test(c));
      if (!inTable) {
        out.push('<div class="my-4 overflow-x-auto"><table class="w-full text-sm border-collapse">');
        out.push("<thead><tr>");
        for (const c of cells) {
          out.push(
            `<th class="text-left font-semibold border-b border-border px-3 py-2">${inline(c)}</th>`
          );
        }
        out.push("</tr></thead><tbody>");
        inTable = true;
        tableHeader = true;
        continue;
      }
      if (tableHeader && isSep) {
        tableHeader = false;
        continue;
      }
      out.push("<tr>");
      for (const c of cells) {
        out.push(`<td class="border-b border-border/50 px-3 py-2 align-top">${inline(c)}</td>`);
      }
      out.push("</tr>");
      continue;
    } else if (inTable) {
      closeTable();
    }

    // List
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      if (!inList) {
        out.push('<ul class="my-2 ml-6 list-disc space-y-1">');
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    } else if (inList) {
      closeList();
    }

    // Paragraph accumulation
    para.push(line);
  }

  flushPara();
  closeList();
  closeTable();
  closeBq();
  if (inFence) out.push("</code></pre>");
  return out.join("\n");
}

export default function Ontology() {
  const html = useMemo(() => renderMarkdown(ontologyMd), []);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    document.title = "Ontology · AWIP Core";
    // Show the change-log date if present in the doc.
    const m = /\*\*([0-9]{4}-[0-9]{2}-[0-9]{2})\*\*/.exec(ontologyMd);
    if (m) setUpdatedAt(m[1]);
  }, []);

  const entityCount = (ontologyMd.match(/^## \d+\./gm) || []).length;

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ontology</h1>
          <p className="text-muted-foreground mt-1">
            Canonical definitions of the entities AWIP Core operates on.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{entityCount} entities</Badge>
          {updatedAt && <Badge variant="outline">Updated {updatedAt}</Badge>}
          <Badge variant="outline">Source: docs/ontology.md</Badge>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Definitions</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            // Markdown is statically imported from a trusted in-repo file at build time.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

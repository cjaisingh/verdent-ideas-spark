import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target } from "lucide-react";
import type { TriageKind, TriageState } from "@/hooks/useMorningReviewTriage";

export type FocusItem = {
  kind: TriageKind;
  ref: string;
  label: string;
  sub?: string;
  panel: string;
};

const KIND_LABELS: Record<TriageKind, string> = {
  discussion_action: "Action",
  sentinel_finding: "Sentinel",
  code_review_finding: "Code review",
  cron_stuck: "Cron",
  deferred: "Deferred",
  promotion_drift: "Drift",
  night_throughput: "Night",
};

export default function DiscussNextStrip({
  items,
  triageMap,
}: {
  items: FocusItem[];
  triageMap: Record<string, TriageState>;
}) {
  const focused = items.filter(
    (i) => triageMap[`${i.kind}::${i.ref}`] === "focus",
  );
  if (focused.length === 0) return null;
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Discuss next
          <Badge variant="secondary" className="ml-1">{focused.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {focused.map((it) => (
          <a
            key={`${it.kind}-${it.ref}`}
            href={`#panel-${slug(it.panel)}`}
            className="flex items-start gap-2 text-sm py-1 border-b border-border/30 last:border-0 hover:bg-background/40 -mx-2 px-2 rounded"
          >
            <Badge variant="outline" className="text-[10px] mt-0.5 shrink-0">
              {KIND_LABELS[it.kind]}
            </Badge>
            <div className="flex-1 min-w-0">
              <div className="font-medium line-clamp-1">{it.label}</div>
              {it.sub && (
                <div className="text-xs text-muted-foreground line-clamp-1">{it.sub}</div>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{it.panel}</span>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

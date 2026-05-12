import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target } from "lucide-react";
import { DiscussThisButton } from "@/components/discussions/DiscussThisButton";
import type { TriageState } from "@/hooks/useMorningReviewTriage";

export type PanelEntry = {
  ref: string;
  title: string;
  count: number;
};

export default function DiscussNextStrip({
  panels,
  triageMap,
}: {
  panels: PanelEntry[];
  triageMap: Record<string, TriageState>;
}) {
  const focused = panels.filter((p) => triageMap[`panel::${p.ref}`] === "focus");
  const revisit = panels.filter((p) => triageMap[`panel::${p.ref}`] === "revisit");
  if (focused.length === 0 && revisit.length === 0) return null;
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Discuss next
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {focused.map((p) => (
          <div
            key={p.ref}
            className="flex items-center gap-2 text-sm py-1.5 border-b border-border/30 last:border-0 hover:bg-background/40 -mx-2 px-2 rounded"
          >
            <Badge className="bg-primary text-primary-foreground text-[10px]">Focus</Badge>
            <a href={`#panel-${p.ref}`} className="font-medium flex-1 hover:underline">{p.title}</a>
            <span className="text-xs text-muted-foreground">{p.count} item{p.count === 1 ? "" : "s"}</span>
            <DiscussThisButton
              subjectType="morning_review_panel"
              subjectId={p.ref}
              title={p.title}
              details={`Focused panel · ${p.count} item${p.count === 1 ? "" : "s"}`}
            />
          </div>
        ))}
        {revisit.map((p) => (
          <div
            key={p.ref}
            className="flex items-center gap-2 text-sm py-1.5 border-b border-border/30 last:border-0 hover:bg-background/40 -mx-2 px-2 rounded"
          >
            <Badge className="bg-amber-500 text-white text-[10px]">Revisit</Badge>
            <a href={`#panel-${p.ref}`} className="font-medium flex-1 hover:underline">{p.title}</a>
            <span className="text-xs text-muted-foreground">{p.count} item{p.count === 1 ? "" : "s"}</span>
            <DiscussThisButton
              subjectType="morning_review_panel"
              subjectId={p.ref}
              title={p.title}
              details={`Revisit panel · ${p.count} item${p.count === 1 ? "" : "s"}`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronUp, BrainCircuit } from "lucide-react";

export type AppliedLesson = {
  id: string;
  lesson: string;
  scope: string;
  reason: string;
  score: number;
};

export type LessonsApplied = {
  at: number;
  user_text: string;
  applied: AppliedLesson[];
};

export function AppliedLessonsCard({ data }: { data: LessonsApplied | null }) {
  const [open, setOpen] = useState(true);
  if (!data) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-muted-foreground" />
            Applied lessons
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            After your first turn, I'll show every lesson Copilot carried into the reply and why it was selected.
          </p>
        </CardContent>
      </Card>
    );
  }
  const top = data.applied.slice(0, 3);
  const rest = data.applied.slice(3);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" />
          Applied lessons for last turn
          <Badge variant="secondary" className="ml-2">{data.applied.length}</Badge>
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {new Date(data.at).toLocaleTimeString()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.user_text && (
          <p className="text-xs italic text-muted-foreground border-l-2 pl-2">
            "{data.user_text}"
          </p>
        )}
        {data.applied.length === 0 ? (
          <p className="text-xs text-muted-foreground">No lessons were active for this turn.</p>
        ) : (
          <>
            <ScrollArea className="max-h-[280px] pr-2">
              <ul className="space-y-2">
                {(open ? data.applied : top).map((a) => (
                  <li key={a.id} className="text-sm border rounded-md p-2 space-y-1">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">{a.scope}</Badge>
                      <Badge variant="secondary" className="text-[10px]">score {a.score}</Badge>
                      <span className="flex-1">{a.lesson}</span>
                    </div>
                    {a.reason && (
                      <p className="text-xs text-muted-foreground pl-1">↳ {a.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
            {rest.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} className="w-full">
                {open ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                {open ? "Show top 3 only" : `Show all ${data.applied.length}`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

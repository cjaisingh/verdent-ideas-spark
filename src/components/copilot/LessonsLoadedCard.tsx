import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GraduationCap, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";

type Lesson = {
  id: string;
  lesson: string;
  scope: "global" | "notebook" | "approvals" | "voice_style";
  active: boolean;
};

export function LessonsLoadedCard() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("copilot_lessons")
      .select("id, lesson, scope, active")
      .eq("active", true)
      .order("created_at", { ascending: false });
    setLessons((data ?? []) as Lesson[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("copilot-lessons-card")
      .on("postgres_changes", { event: "*", schema: "public", table: "copilot_lessons" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Active lessons</CardTitle>
          <Badge variant="secondary">{lessons.length}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)} disabled={lessons.length === 0}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/copilot/lessons">Manage</Link>
          </Button>
        </div>
      </CardHeader>
      {open && lessons.length > 0 && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground mb-2">
            Loaded into every brain turn for this session.
          </p>
          <ScrollArea className="max-h-64">
            <ul className="space-y-2 pr-2">
              {lessons.map(l => (
                <li key={l.id} className="text-sm flex items-start gap-2 p-2 rounded-md border">
                  <Badge variant="outline" className="text-xs shrink-0">{l.scope}</Badge>
                  <span className="flex-1">{l.lesson}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </CardContent>
      )}
      {lessons.length === 0 && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            No active lessons. Say "learn from this: …" during a call, or add some on the Lessons page.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

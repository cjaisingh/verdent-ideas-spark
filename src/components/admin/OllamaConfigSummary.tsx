// Live summary of currently configured Ollama defaults across registered workers.
// Reads `ai_workers` state passed in from /admin/ai-jobs (which already has a
// realtime subscription on the table) — so this card updates as workers come
// online, change tags, or fall offline.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu } from "lucide-react";

type Worker = {
  id: string;
  name: string;
  enabled: boolean;
  model_tags: string[];
  default_model: string | null;
  last_seen_at: string | null;
};

const FRESH_MS = 2 * 60 * 1000; // 2 min — worker polls every 5s, heartbeats every 20s

function isFresh(w: Worker, now: number) {
  if (!w.last_seen_at) return false;
  return now - new Date(w.last_seen_at).getTime() < FRESH_MS;
}

export function OllamaConfigSummary({
  workers,
  loading,
}: {
  workers: Worker[];
  loading: boolean;
}) {
  const now = Date.now();
  const enabled = workers.filter((w) => w.enabled);
  const online = enabled.filter((w) => isFresh(w, now));
  const defaultModels = Array.from(
    new Set(online.map((w) => w.default_model).filter((m): m is string => !!m)),
  );
  const allTags = Array.from(new Set(online.flatMap((w) => w.model_tags))).sort();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          Ollama configuration
          <span className="text-xs font-normal text-muted-foreground">
            {online.length}/{enabled.length} online
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-12 w-full" />
        ) : online.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No worker has reported in the last 2&nbsp;minutes. Start the Ollama worker
            script and it will register itself within one poll.
          </p>
        ) : (
          <>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Default model</div>
              <div className="flex flex-wrap gap-1">
                {defaultModels.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    (worker reported no <code>DEFAULT_MODEL</code> — update worker.mjs)
                  </span>
                ) : (
                  defaultModels.map((m) => (
                    <Badge key={m} className="font-mono">{m}</Badge>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Available model tags ({allTags.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {allTags.length === 0 ? (
                  <span className="text-sm text-muted-foreground">none reported</span>
                ) : (
                  allTags.map((t) => (
                    <Badge key={t} variant="outline" className="font-mono text-[11px]">
                      {t}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

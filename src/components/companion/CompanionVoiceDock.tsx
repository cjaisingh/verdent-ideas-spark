// CompanionVoiceDock — placeholder mount point.
// The full Deepgram realtime voice loop (lifted from /copilot) will land in a
// follow-up edit; this stub keeps the page compiling and shows a clear status
// so the operator knows where voice will appear.
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Sparkles } from "lucide-react";

export function CompanionVoiceDock({ threadId }: { threadId: string | null }) {
  return (
    <Card className="border-dashed border-primary/30">
      <CardContent className="py-3 flex items-center gap-3 text-sm">
        <Mic className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <div className="font-medium flex items-center gap-1.5">
            Voice dock
            <Sparkles className="h-3 w-3 text-amber-500" />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">coming next</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Two-way voice (Deepgram STT + Aura TTS) will mount here and write turns into the active
            thread{threadId ? "" : " — open or create a thread first"}. Reuses the existing
            <code className="mx-1">copilot-voice</code> WebSocket from <code>/copilot</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

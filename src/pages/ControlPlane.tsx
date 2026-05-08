import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ApprovalDecisions from "@/components/ApprovalDecisions";
import EventStream from "@/components/control-plane/EventStream";
import DemandTable from "@/components/control-plane/DemandTable";
import { Send } from "lucide-react";

const ControlPlane = () => {
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [botStatus, setBotStatus] = useState<"loading" | "ok" | "error">("loading");

  // Lightweight Telegram status chip — full config lives on /admin
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("telegram-bot-info");
        if (cancelled) return;
        if (error) { setBotStatus("error"); return; }
        const d = data as { username?: string | null; error?: string };
        if (d?.error) { setBotStatus("error"); return; }
        setBotUsername(d?.username ?? null);
        setBotStatus("ok");
      } catch {
        if (!cancelled) setBotStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Control Plane</h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of the AWIP contract. Auto-refresh every 5s.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Link
            to="/admin#telegram"
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/40 transition"
            title="Manage Telegram bot on the Admin page"
          >
            <Send className="h-3 w-3" />
            <span className="font-mono">
              {botStatus === "loading" && "Telegram: …"}
              {botStatus === "ok" && `Telegram: @${botUsername ?? "unknown"}`}
              {botStatus === "error" && "Telegram: not configured"}
            </span>
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                botStatus === "ok" ? "bg-emerald-500" : botStatus === "error" ? "bg-destructive" : "bg-muted-foreground"
              }`}
            />
          </Link>
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="border border-destructive/50 text-destructive text-sm rounded-md p-3 font-mono">
          {error}
        </div>
      )}

      <ApprovalDecisions />

      <Tabs defaultValue="demand">
        <TabsList>
          <TabsTrigger value="demand">Demand board</TabsTrigger>
          <TabsTrigger value="feed">Live event feed</TabsTrigger>
        </TabsList>

        <TabsContent value="demand" className="mt-4">
          <DemandTable paused={paused} onError={setError} />
        </TabsContent>

        <TabsContent value="feed" className="mt-4">
          <EventStream paused={paused} onError={setError} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ControlPlane;

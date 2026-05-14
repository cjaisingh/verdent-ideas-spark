import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  acknowledgeAllTriage,
  acknowledgeTriage,
  useTriageActivity,
} from "@/hooks/useSentinelTriageActivity";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function SentinelTriageActivityPanel() {
  const { rows, loading } = useTriageActivity(25);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  const unackedCount = rows.filter((r) => !uid || !r.acknowledged_by.includes(uid)).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" />
          Sentinel triage activity
          {unackedCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {unackedCount} new
            </Badge>
          )}
        </CardTitle>
        {unackedCount > 0 && (
          <Button size="sm" variant="ghost" onClick={() => acknowledgeAllTriage()}>
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Acknowledge all
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No grouped triage events yet. Logged when an action accumulates 2+ sentinel findings.
          </div>
        )}
        {rows.map((r) => {
          const acked = uid ? r.acknowledged_by.includes(uid) : false;
          return (
            <div
              key={r.id}
              className={`flex items-start gap-2 rounded border p-2 text-xs ${
                acked ? "opacity-60" : "bg-muted/30"
              }`}
            >
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={r.event_kind === "group_formed" ? "default" : "outline"} className="text-[10px]">
                    {r.event_kind === "group_formed" ? "Group formed" : "Group grew"}
                  </Badge>
                  <span className="text-muted-foreground">
                    {r.finding_count} findings
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </span>
                </div>
                <Link
                  to={`/jobs?action=${r.action_id}`}
                  className="block font-medium hover:underline"
                >
                  #{r.action_short_num} {r.action_title}
                </Link>
                {r.triggered_by_label && (
                  <div className="text-[10px] text-muted-foreground">by {r.triggered_by_label}</div>
                )}
              </div>
              {!acked && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={() => acknowledgeTriage(r.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

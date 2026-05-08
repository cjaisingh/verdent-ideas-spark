import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import type { CapabilityPromotionStatus } from "@/lib/promotion-gates-types";

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

export const PromotionBadge = ({ capabilityId }: { capabilityId: string }) => {
  const [status, setStatus] = useState<CapabilityPromotionStatus | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const r = await fetch(`${FN}/capabilities/${encodeURIComponent(capabilityId)}/promotion-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 403) { setDenied(true); return; }
      if (r.ok) setStatus(await r.json());
    })();
  }, [capabilityId]);

  if (denied || !status) return null;
  const { summary, gates } = status;
  const topBlock = gates.find((g) => g.verdict === "fail") ?? gates.find((g) => g.verdict === "warn");

  return (
    <div className="border border-border rounded-md p-3 flex items-center gap-3 bg-muted/20">
      <Badge variant={summary.fail > 0 ? "destructive" : summary.warn > 0 ? "secondary" : "default"} className="font-mono text-[10px] uppercase">
        Phase 3
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">
          {summary.fail > 0 ? "Blocked from promotion" : summary.warn > 0 ? "Ready with warnings" : "Ready to promote"}
        </div>
        {topBlock && (
          <div className="text-xs text-muted-foreground truncate">{topBlock.reason}</div>
        )}
      </div>
      <Link to="/admin/capability-promotion" className="text-xs text-primary hover:underline shrink-0">
        Open admin →
      </Link>
    </div>
  );
};

import { useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const navCls = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm ${
    isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
  }`;

// Module-scoped dedupe: survives remounts and prevents duplicate toasts
// when multiple realtime payloads arrive for the same id+status transition.
const toastedDecisions = new Set<string>();

const OperatorLayout = () => {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  useEffect(() => {
    const channel = supabase
      .channel("approval_queue_decisions")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "approval_queue" },
        (payload) => {
          const next = payload.new as { id: string; status: string; activity?: string; decided_by?: string };
          const prev = payload.old as { status: string };
          if (prev?.status === next?.status) return;
          if (next.status !== "approved" && next.status !== "rejected") return;
          const dedupeKey = `${next.id}:${next.status}`;
          if (toastedDecisions.has(dedupeKey)) return;
          toastedDecisions.add(dedupeKey);
          const action = {
            label: "View",
            onClick: () => navigate(`/approvals/${next.id}`),
          };
          const opts = {
            id: dedupeKey,
            description: `${next.activity ?? "request"} • by ${next.decided_by ?? "operator"} • ${next.id.slice(0, 8)}`,
            action,
          };
          if (next.status === "approved") toast.success("Approval approved", opts);
          else toast.error("Approval rejected", opts);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link to="/tenants" className="font-semibold">
            AWIP Core
          </Link>
          <nav className="flex gap-1">
            <NavLink to="/tenants" className={navCls}>Tenants</NavLink>
            <NavLink to="/capabilities" className={navCls}>Capabilities</NavLink>
            <NavLink to="/events" className={navCls}>Events</NavLink>
            <NavLink to="/api-logs" className={navCls}>API logs</NavLink>
            <NavLink to="/control-plane" className={navCls}>Control plane</NavLink>
            <NavLink to="/api-explorer" className={navCls}>API explorer</NavLink>
            <NavLink to="/admin" className={navCls}>Admin</NavLink>
            <NavLink to="/status" className={navCls}>Status</NavLink>
          </nav>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
};

export default OperatorLayout;

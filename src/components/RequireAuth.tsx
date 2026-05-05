import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setState(session ? "in" : "out");
    });
    supabase.auth.getSession().then(({ data }) => setState(data.session ? "in" : "out"));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (state === "loading") return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (state === "out") return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

export default RequireAuth;

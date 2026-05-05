import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-2xl w-full space-y-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">AWIP Core</p>
          <h1 className="text-4xl font-semibold tracking-tight">The OKR substrate</h1>
          <p className="text-muted-foreground">
            Versioned OKR trees, a capability manifest, and an audit-grade event log.
            The spine that every future AWIP module hangs off.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link to={authed ? "/tenants" : "/auth"}>
              {authed ? "Open operator console" : "Sign in"}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/capabilities">Capability manifest</Link>
          </Button>
        </div>
      </div>
    </main>
  );
};

export default Index;

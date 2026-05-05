import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const navCls = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm ${
    isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
  }`;

const OperatorLayout = () => {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };
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

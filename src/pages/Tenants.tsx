import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Tenant = { id: string; name: string; slug: string; created_at: string };

const Tenants = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const load = async () => {
    const { data, error } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setTenants(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("tenants").insert({ name, slug });
    if (error) return toast.error(error.message);
    setName(""); setSlug("");
    load();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <p className="text-sm text-muted-foreground">Client engagements. Each has its own OKR tree.</p>
      </div>

      <form onSubmit={create} className="flex gap-2 items-end border border-border rounded-md p-4">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Acme Corp" />
        </div>
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">Slug</label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} required placeholder="acme" />
        </div>
        <Button type="submit">Add tenant</Button>
      </form>

      <div className="border border-border rounded-md divide-y divide-border">
        {tenants.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No tenants yet.</div>
        )}
        {tenants.map((t) => (
          <Link key={t.id} to={`/tenants/${t.id}`} className="block p-4 hover:bg-secondary/50">
            <div className="font-medium">{t.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{t.slug}</div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default Tenants;

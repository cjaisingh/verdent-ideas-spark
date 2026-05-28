// External contact detail page. Surfaces the contact's profile and the
// W8.1 reminders panel scoped to subject_type='external_contact'.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RemindersPanel } from "@/components/scheduler/RemindersPanel";
import { toast } from "sonner";

type Contact = {
  id: string;
  display_name: string;
  organisation: string | null;
  email: string | null;
  phone: string | null;
  telegram_chat_id: string | null;
  notes: string | null;
  tenant_id: string | null;
  created_at: string;
};

export default function ContactDetail() {
  const { id } = useParams();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    supabase
      .from("external_contacts")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setContact((data as Contact) ?? null);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!contact) {
    return (
      <div className="space-y-2">
        <Link to="/tenants" className="text-xs text-muted-foreground hover:underline">← Tenants</Link>
        <p className="text-sm text-muted-foreground">Contact not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/tenants" className="text-xs text-muted-foreground hover:underline">← Tenants</Link>
        <div className="flex items-center gap-2 mt-1">
          <h1 className="text-2xl font-semibold">{contact.display_name}</h1>
          {contact.telegram_chat_id && <Badge variant="outline">Telegram linked</Badge>}
        </div>
        {contact.organisation && (
          <p className="text-sm text-muted-foreground">{contact.organisation}</p>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div><span className="text-muted-foreground">Email:</span> {contact.email ?? "—"}</div>
          <div><span className="text-muted-foreground">Phone:</span> {contact.phone ?? "—"}</div>
          <div><span className="text-muted-foreground">Telegram chat id:</span> {contact.telegram_chat_id ?? "—"}</div>
          <div><span className="text-muted-foreground">Tenant:</span> {contact.tenant_id ?? "—"}</div>
          {contact.notes && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Notes:</span>
              <p className="whitespace-pre-wrap mt-1">{contact.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <RemindersPanel
        subjectType="external_contact"
        subjectId={contact.id}
        tenantId={contact.tenant_id}
        subjectLabel={contact.display_name}
      />
    </div>
  );
}

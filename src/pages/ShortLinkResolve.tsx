import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function ShortLinkResolve() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!slug) {
        setError("Missing slug");
        return;
      }
      const { data, error } = await supabase.rpc("short_link_resolve", {
        _slug: slug,
      });
      if (cancelled) return;
      if (error || !data || data.length === 0) {
        setError(error?.message ?? "Short link not found");
        return;
      }
      const row = data[0] as { target_path: string; target_query: Record<string, string> };
      const qs = new URLSearchParams(row.target_query ?? {}).toString();
      navigate(`${row.target_path}${qs ? `?${qs}` : ""}`, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 text-sm text-muted-foreground">
      {error ? `Link error: ${error}` : "Resolving link…"}
    </div>
  );
}

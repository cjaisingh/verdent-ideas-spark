import { useEffect, useState } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { supabase } from "@/integrations/supabase/client";
import { openApiSpec } from "@/lib/openapi";
import { Button } from "@/components/ui/button";

const ApiExplorer = () => {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
    });
  }, []);

  const copyToken = async () => {
    if (token) await navigator.clipboard.writeText(token);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">API Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Live OpenAPI spec for the <code className="font-mono text-xs">awip-api</code> edge function.
            Click <strong>Authorize</strong> and paste your operator JWT (or service token) to try requests.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={copyToken} disabled={!token}>
          {token ? "Copy my JWT" : "No session"}
        </Button>
      </div>

      <div className="bg-card rounded-md border border-border swagger-host">
        <SwaggerUI
          spec={openApiSpec}
          docExpansion="list"
          tryItOutEnabled
          persistAuthorization
        />
      </div>
    </div>
  );
};

export default ApiExplorer;

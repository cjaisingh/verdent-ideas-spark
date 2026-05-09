import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Apple, Copy, Share2, X, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const DISMISS_KEY = "awip.companion.iphone-install-dismissed.v1";

/**
 * Help card shown to iOS Safari users (or anyone trying to install on iPhone)
 * with the exact Add-to-Home-Screen flow + a publish-URL warning when we detect
 * the editor preview origin (where iOS install will silently fail).
 */
export function IphoneInstallHelpCard() {
  const [dismissed, setDismissed] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1"
  );

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true);

  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isPreviewHost = useMemo(
    () => /id-preview--|lovableproject\.com|lovable\.app/.test(host) && !host.startsWith("c58aeaea"),
    [host]
  );

  // One-time toast: warn when the user is on a preview origin where iOS install will not work properly.
  useEffect(() => {
    if (!isIos || dismissed || isStandalone) return;
    if (isPreviewHost) {
      toast({
        title: "iPhone install needs the published URL",
        description:
          "iOS only installs PWAs from the live published origin opened in Safari directly — not the editor preview.",
      });
    }
  }, [isIos, dismissed, isStandalone, isPreviewHost]);

  if (dismissed || isStandalone) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "URL copied", description: "Paste into Safari on your iPhone." });
    } catch {
      toast({ title: "Couldn't copy", description: window.location.href, variant: "destructive" });
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Apple className="h-4 w-4" />
          Install Companion on iPhone
        </CardTitle>
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ol className="list-decimal pl-5 space-y-1 text-xs">
          <li>
            Open the <strong>published URL</strong> on your iPhone in <strong>Safari</strong>{" "}
            (Chrome on iOS cannot install PWAs).
          </li>
          <li>
            Tap the <Share2 className="inline h-3 w-3 mb-0.5" /> Share button at the bottom of Safari.
          </li>
          <li>
            Scroll and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
          <li>
            Launch the new <em>Companion</em> icon from your home screen — it opens full-screen and
            runs the cloud brain + voice (text + RAG + live state all work).
          </li>
        </ol>
        {isPreviewHost && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ You're currently on the editor preview origin. iOS will install a generic Safari
            shortcut, not the Companion PWA. Click <strong>Publish</strong> in Lovable, then open
            the resulting <code>.lovable.app</code> URL on your iPhone.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copyUrl}>
            <Copy className="h-3.5 w-3.5 mr-1" />
            Copy this URL
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open("https://docs.lovable.dev", "_blank", "noopener")}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            How to publish
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Install button for the Companion PWA (manifest-only, scope=/companion).
 * - Chrome/Edge/Android: triggers native beforeinstallprompt
 * - iOS Safari: shows Add-to-Home-Screen instructions (no programmatic prompt available)
 */
export function InstallPwaButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(false);

  useEffect(() => {
    // Already installed / running standalone?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as any).standalone === true;
    if (standalone) setInstalled(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      toast({ title: "Companion installed", description: "You can launch it from your home screen / Dock." });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  if (installed) {
    return (
      <Button variant="ghost" size="sm" disabled className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Installed
      </Button>
    );
  }

  const handleClick = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        toast({ title: "Installing Companion…" });
      }
      setDeferred(null);
      return;
    }
    if (isIos) {
      toast({
        title: "Install on iOS",
        description: "Tap the Share button in Safari, then 'Add to Home Screen'.",
      });
      return;
    }
    toast({
      title: "Install not available yet",
      description:
        "Open this page in Chrome/Edge/Safari (not an iframe). On Mac Chrome, use the install icon in the address bar.",
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} className="gap-1.5">
      <Download className="h-3.5 w-3.5" /> Install
    </Button>
  );
}

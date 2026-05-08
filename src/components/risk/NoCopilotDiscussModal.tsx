import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { buildFindingMarkdown, type FindingForContext } from "@/lib/findingContext";
import { Copy, MessagesSquare } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  finding: FindingForContext;
  onMarked?: () => void;
};

export function NoCopilotDiscussModal({ open, onOpenChange, finding, onMarked }: Props) {
  const [marked, setMarked] = useState(false);
  const md = buildFindingMarkdown(finding);

  const copy = async () => {
    try { await navigator.clipboard.writeText(md); toast({ title: "Copied", description: "Paste into the Lovable chat to continue." }); }
    catch { toast({ title: "Copy failed", description: "Select the text manually.", variant: "destructive" }); }
  };

  const markDiscussing = async () => {
    const { error } = await supabase.from("roadmap_review_findings")
      .update({ discussion_status: "in_lovable_chat" }).eq("id", finding.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setMarked(true);
    onMarked?.();
    toast({ title: "Marked as discussing", description: "Finding now shows it's in Lovable chat." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessagesSquare className="h-4 w-4" /> Discuss in Lovable chat
          </DialogTitle>
          <DialogDescription>
            Copy this context, then paste it into the Lovable chat window so we can work through it together.
          </DialogDescription>
        </DialogHeader>
        <pre className="text-xs bg-muted/40 border rounded-md p-3 max-h-72 overflow-auto whitespace-pre-wrap">{md}</pre>
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={markDiscussing} disabled={marked}>
            {marked ? "Marked ✓" : "Mark as 'in Lovable chat'"}
          </Button>
          <Button onClick={copy}><Copy className="h-4 w-4 mr-1" /> Copy & open chat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot } from "lucide-react";
import type { CopilotAgent } from "@/hooks/useCopilotAgents";

type Props = {
  agents: CopilotAgent[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Strip of agent chips. The active agent is highlighted; clicking another
 * switches without a session restart (the audio session keeps running, only
 * the persona swaps in).
 */
export function AgentSelector({ agents, activeId, onSelect }: Props) {
  if (agents.length === 0) return null;
  const active = agents.find((a) => a.id === activeId);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot className="size-4" /> Active agent
        {active && (
          <Badge variant="secondary" className="ml-1 font-mono text-[10px]">
            wake: "hey {active.wake_word}"
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {agents.map((a) => {
          const isActive = a.id === activeId;
          return (
            <Button
              key={a.id}
              size="sm"
              variant={isActive ? "default" : "outline"}
              className="h-9"
              onClick={() => onSelect(a.id)}
              disabled={!a.enabled}
              title={a.description ?? a.name}
            >
              <span className={isActive ? "" : "text-muted-foreground"}>●</span>
              <span className="ml-2 font-medium">{a.name}</span>
              <span className="ml-2 text-[10px] text-muted-foreground">/{a.slug}</span>
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Say <span className="font-mono">"hey &lt;name&gt;"</span> mid-session to switch agents.
      </p>
    </Card>
  );
}

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type BotInfo = {
  username: string | null;
  first_name?: string;
  id?: number;
  url: string | null;
  expected_username?: string | null;
  mismatch?: boolean;
};

type BotError = {
  message: string;
  status?: number;
  detail?: unknown;
  at: string;
};

const TelegramBotPanel = () => {
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [botError, setBotError] = useState<BotError | null>(null);
  const [botLoading, setBotLoading] = useState(false);
  const [chatIds, setChatIds] = useState<number[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string>("");
  const [tgSending, setTgSending] = useState(false);
  const botFailCount = useRef(0);
  const botRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [botNextRetryAt, setBotNextRetryAt] = useState<number | null>(null);

  const clearBotRetry = () => {
    if (botRetryTimer.current) {
      clearTimeout(botRetryTimer.current);
      botRetryTimer.current = null;
    }
    setBotNextRetryAt(null);
  };

  const scheduleBotRetry = () => {
    botFailCount.current += 1;
    const delayMs = Math.min(60_000, 2_000 * 2 ** (botFailCount.current - 1));
    setBotNextRetryAt(Date.now() + delayMs);
    botRetryTimer.current = setTimeout(() => {
      botRetryTimer.current = null;
      setBotNextRetryAt(null);
      loadBotInfo();
    }, delayMs);
  };

  const loadBotInfo = async () => {
    clearBotRetry();
    setBotLoading(true);
    setBotError(null);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-bot-info");
      if (error) throw error;
      const d = data as BotInfo & { error?: string; status?: number; detail?: unknown };
      if (d?.error) {
        setBotInfo(null);
        setBotError({ message: d.error, status: d.status, detail: d.detail, at: new Date().toISOString() });
        scheduleBotRetry();
        return;
      }
      botFailCount.current = 0;
      setBotInfo(d);
    } catch (e) {
      setBotInfo(null);
      setBotError({ message: (e as Error).message, at: new Date().toISOString() });
      scheduleBotRetry();
    } finally {
      setBotLoading(false);
    }
  };

  const loadChatIds = async () => {
    const { data } = await supabase
      .from("operator_messages")
      .select("chat_id")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(200);
    const unique = Array.from(new Set((data ?? []).map((r) => Number(r.chat_id))));
    setChatIds(unique);
    if (unique.length && !selectedChatId) setSelectedChatId(String(unique[0]));
  };

  const sendTelegramTest = async () => {
    setTgSending(true);
    try {
      const body = selectedChatId ? { chat_id: Number(selectedChatId) } : {};
      const { data, error } = await supabase.functions.invoke("telegram-test", { body });
      if (error) throw error;
      const d = data as { error?: string; chat_id?: number };
      if (d?.error) throw new Error(d.error);
      toast({ title: "Telegram ping sent", description: `chat_id ${d?.chat_id}` });
    } catch (e) {
      toast({
        title: "Telegram test failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setTgSending(false);
    }
  };

  useEffect(() => {
    loadBotInfo();
    loadChatIds();
    return () => clearBotRetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section id="telegram" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Telegram bot</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={loadChatIds} title="Reload chat IDs">
            ↻ Refresh chats
          </Button>
          <Select value={selectedChatId} onValueChange={setSelectedChatId}>
            <SelectTrigger className="w-44 h-9 text-xs">
              <SelectValue placeholder={chatIds.length ? "Pick chat" : "No chats yet"} />
            </SelectTrigger>
            <SelectContent>
              {chatIds.map((id) => (
                <SelectItem key={id} value={String(id)} className="font-mono text-xs">
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={sendTelegramTest} disabled={tgSending || !selectedChatId}>
            {tgSending ? "Sending…" : "Send test"}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-md p-4 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
              TG
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Bot identity</div>
              {botLoading && !botInfo && !botError && (
                <div className="text-sm text-muted-foreground">Loading…</div>
              )}
              {botInfo && (
                <div className="text-sm font-medium truncate">
                  {botInfo.first_name ?? "Bot"}{" "}
                  <span className="font-mono text-muted-foreground">@{botInfo.username ?? "unknown"}</span>
                  {botInfo.id != null && (
                    <span className="ml-2 text-xs text-muted-foreground font-mono">id {botInfo.id}</span>
                  )}
                </div>
              )}
              {botError && !botInfo && (
                <div className="text-sm text-destructive font-medium">
                  Gateway failure
                  {botError.status ? <span className="font-mono"> · {botError.status}</span> : null}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={loadBotInfo} disabled={botLoading}>
              {botLoading ? "Refreshing…" : "↻ Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild disabled={!botInfo?.url}>
              <a
                href={botInfo?.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!botInfo?.url}
              >
                Open in Telegram ↗
              </a>
            </Button>
          </div>
        </div>

        {botInfo?.mismatch && botInfo.expected_username && (
          <div className="border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md p-3 text-sm">
            <div className="font-medium">Bot username mismatch</div>
            <div className="text-xs font-mono mt-1">
              expected <span className="font-semibold">@{botInfo.expected_username}</span> · got{" "}
              <span className="font-semibold">@{botInfo.username ?? "unknown"}</span>
            </div>
            <div className="text-xs mt-1 opacity-80">
              The connected TELEGRAM_API_KEY points to a different bot than expected. Update the
              connector or the <code className="font-mono">TELEGRAM_EXPECTED_BOT_USERNAME</code> secret.
            </div>
          </div>
        )}

        {botError && (
          <div className="border border-destructive/40 bg-destructive/5 rounded-md p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-destructive font-mono break-all">{botError.message}</div>
              <Button variant="outline" size="sm" onClick={loadBotInfo} disabled={botLoading} className="shrink-0">
                {botLoading ? "Retrying…" : "Try again"}
              </Button>
            </div>
            {botError.detail != null && (
              <pre className="text-[11px] font-mono text-muted-foreground bg-background/50 rounded p-2 overflow-auto max-h-40">
{JSON.stringify(botError.detail, null, 2)}
              </pre>
            )}
            <div className="text-[11px] text-muted-foreground font-mono flex justify-between gap-2">
              <span>at {new Date(botError.at).toLocaleTimeString()}</span>
              {botNextRetryAt && !botLoading && (
                <span>
                  next retry in {Math.max(0, Math.ceil((botNextRetryAt - Date.now()) / 1000))}s
                  {botFailCount.current > 1 ? ` (attempt ${botFailCount.current + 1})` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default TelegramBotPanel;

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWIP_SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
const TEST_CHAT_ID = Deno.env.get("TEST_TELEGRAM_CHAT_ID") ?? "0";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function callSend(opts: { forceFail?: boolean }) {
  return await fetch(`${SUPABASE_URL}/functions/v1/telegram-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-token": AWIP_SERVICE_TOKEN,
      "x-caller": "e2e-smoke",
      ...(opts.forceFail ? { "x-force-fail": "1" } : {}),
    },
    body: JSON.stringify({ chat_id: TEST_CHAT_ID, text: `smoke ${crypto.randomUUID()}` }),
  });
}

Deno.test({
  name: "telegram-send force-fail writes failed row",
  ignore: !AWIP_SERVICE_TOKEN,
  fn: async () => {
    const res = await callSend({ forceFail: true });
    await res.text();
    assertEquals(res.status, 502);

    // small delay for insert
    await new Promise((r) => setTimeout(r, 500));
    const { data } = await admin
      .from("telegram_send_log")
      .select("status, caller, error")
      .eq("caller", "e2e-smoke")
      .order("created_at", { ascending: false })
      .limit(1);
    assert(data && data.length > 0, "expected telegram_send_log row");
    assertEquals(data![0].status, "error");
    assertEquals(data![0].caller, "e2e-smoke");
  },
});

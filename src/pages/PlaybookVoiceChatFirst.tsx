import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { BookOpen, Mic, MessageSquareWarning, ArrowRight } from "lucide-react";

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="flex-none w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center mt-0.5">
      {n}
    </span>
    <div className="space-y-1">
      <p className="font-medium text-sm">{title}</p>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  </li>
);

export default function PlaybookVoiceChatFirst() {
  return (
    <div className="container mx-auto py-6 space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          <span>Playbook</span>
          <Badge variant="outline" className="text-[10px]">persistent</Badge>
        </div>
        <h1 className="text-2xl font-semibold mt-1">Voice setup + chat-first policy work</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Source of truth for two interlocking lessons. Anything that touches voice
          pipelines or "should we monitor / threshold / alert on X" must follow this
          checklist before code is written. Markdown source:{" "}
          <code className="text-xs">docs/playbooks/voice-and-chat-first.md</code>.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4" /> 1. Voice setup timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The wizard at{" "}
            <Link to="/voice-setup" className="underline">/voice-setup</Link>{" "}
            exists because we kept rebuilding the same five steps ad-hoc.
            Future voice work follows this order. Skipping a step is a defect.
          </p>
          <ol className="space-y-3 list-none">
            <Step n={1} title="Confirm scope (≤4 ask_questions)">
              Browser only, browser + Rork, or diagnostics only.
            </Step>
            <Step n={2} title="Pick providers">
              TTS default <code className="text-xs">gemini-tts</code>; STT default
              browser Web Speech. Any other provider needs a secret + cost note before code.
            </Step>
            <Step n={3} title="Persist config in voice_config">
              Operator-scoped, RLS, realtime. Never localStorage for shared state —
              Rork reads the table directly.
            </Step>
            <Step n={4} title="Validate end-to-end">
              Mic permission + level peak ≥ 25, then full loop:
              STT → <code className="text-xs">companion-cloud-chat</code> →{" "}
              <code className="text-xs">gemini-tts</code> playback, logged through{" "}
              <code className="text-xs">ai_usage_log</code>.
            </Step>
            <Step n={5} title="Observe at /admin/voice-health">
              Bands: green &lt; 2% errors, amber 2–10%, red &gt; 10% OR no success
              in 60min over a 1h window. Sentinel kind{" "}
              <code className="text-xs">voice_pipeline_red</code> (high) auto-fires
              and rolls into morning review.
            </Step>
          </ol>
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <p className="font-medium">Standing constraints</p>
            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
              <li>TTS bypasses night-cheap model policy — <code>gemini-tts</code> always uses the requested TTS model.</li>
              <li>Browser Web Speech leaves no server trace; STT health is n/a on the dashboard.</li>
              <li>Rork reads <code>voice_config</code> directly — schema changes need the Expo app in lockstep (<code>docs/rork-companion-spec.md</code>).</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquareWarning className="h-4 w-4" /> 2. Chat-first for policy work
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">Hard rule</p>
            <p className="text-foreground/90">
              Policy/threshold-shaped requests require a confirmation chat before
              any migration or edge code is written.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Triggers (any one is enough)</p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
              <li>Words: monitor, alert, threshold, SLA, SLO, eligibility, auto-X.</li>
              <li>A number a human had to pick (rate, window, count, age).</li>
              <li>A who/when decision (who gets paged, when does it fire).</li>
              <li>A request dressed as "build" but really design.</li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Required questions (≤4, batched)</p>
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-0.5">
              <li><b>Event definition + signal source.</b> Which table/field/log line is ground truth? Server-side rows only.</li>
              <li><b>Thresholds + window + severity tiers.</b> Concrete numbers. Default 1h for live ops, 24h for trends.</li>
              <li><b>Who/what gets notified.</b> Page-only, sentinel finding, Telegram alert, or escalation.</li>
              <li><b>Scope of this turn.</b> Minimum viable vs full. Default minimum; expand next turn.</li>
            </ol>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Out of scope — build immediately</p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
              <li>Deterministic edits where every number/target is named.</li>
              <li>Pure UI/visual refinements.</li>
              <li>Unambiguous bug fixes against a known reproducer.</li>
            </ul>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="font-medium mb-1">What this prevents</p>
            <p className="text-muted-foreground">
              Numbers chosen by the AI rather than the operator. Monitors that fire on
              metrics nobody can act on. Rebuild cycles when the operator's mental model
              differs from the build.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cross-references</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1.5">
            <li className="flex items-center gap-2">
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <Link to="/voice-setup" className="underline">/voice-setup</Link>
              <span className="text-muted-foreground">— the wizard</span>
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <Link to="/admin/voice-health" className="underline">/admin/voice-health</Link>
              <span className="text-muted-foreground">— live dashboard</span>
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <code className="text-xs">mem://preferences/chat-first-policy-requests</code>
              <span className="text-muted-foreground">— the rule</span>
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <code className="text-xs">mem://features/voice-health</code>
              <span className="text-muted-foreground">— dashboard contract</span>
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <code className="text-xs">docs/rork-companion-spec.md</code>
              <span className="text-muted-foreground">— iPhone surface contract</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        To revise: edit <code>docs/playbooks/voice-and-chat-first.md</code>, update
        the matching memory entry if the rule changes, note the change in{" "}
        <code>CHANGELOG.md</code>, and keep this page in sync in the same commit.
      </p>
    </div>
  );
}

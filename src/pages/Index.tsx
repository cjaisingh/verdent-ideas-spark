import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type EventRow = { event_type: string; created_at: string; id: string };

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [capCount, setCapCount] = useState<number | null>(null);
  const [lastEvent, setLastEvent] = useState<EventRow | null>(null);
  const [hourlyBuckets, setHourlyBuckets] = useState<number[]>([]);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));

    (async () => {
      const { count } = await supabase.from("capabilities").select("*", { count: "exact", head: true });
      setCapCount(count ?? 0);

      const { data: ev } = await supabase
        .from("capability_events")
        .select("id, event_type, created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (ev && ev[0]) setLastEvent(ev[0] as EventRow);

      // 12 hourly buckets, last 12h of capability_events
      const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("capability_events")
        .select("created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      const buckets = new Array(12).fill(0);
      const startMs = Date.now() - 12 * 60 * 60 * 1000;
      (recent ?? []).forEach((r: { created_at: string }) => {
        const idx = Math.min(11, Math.floor((new Date(r.created_at).getTime() - startMs) / (60 * 60 * 1000)));
        if (idx >= 0) buckets[idx]++;
      });
      setHourlyBuckets(buckets);
    })();

    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const maxBucket = Math.max(1, ...hourlyBuckets);
  const totalPerHour = hourlyBuckets.length ? Math.round(hourlyBuckets.reduce((a, b) => a + b, 0) / 12) : 0;
  const eventLabel = lastEvent
    ? `${lastEvent.event_type.toUpperCase()}_${lastEvent.id.replace(/-/g, "").slice(0, 8).toUpperCase()}…${lastEvent.id.replace(/-/g, "").slice(-3).toUpperCase()}`
    : "AWAITING_SUBSTRATE_SYNC";
  const timeLabel = now.toISOString().slice(11, 19) + "." + String(now.getMilliseconds()).padStart(3, "0").slice(0, 2);

  return (
    <main className="min-h-screen bg-[#0d0d0d] flex items-center justify-center p-6 sm:p-12 font-['Manrope'] antialiased text-white/90">
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Sora:wght@400;600;700&display=swap" rel="stylesheet" />
      <div className="max-w-7xl w-full grid grid-cols-1 md:grid-cols-4 gap-4">

        {/* Main Hero Tile (2x2) */}
        <div className="md:col-span-2 md:row-span-2 bg-[#1a1a1a] border border-[#c9a84c]/30 p-8 sm:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <span className="h-px w-8 bg-[#c9a84c]" />
              <span className="text-[10px] uppercase tracking-[0.3em] text-[#c9a84c] font-semibold font-['Sora']">AWIP CORE</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-['Sora'] font-semibold text-[#f0d78c] leading-tight mb-6">
              The OKR<br />substrate
            </h1>
            <p className="text-base text-white/50 max-w-md leading-relaxed">
              Versioned OKR trees, a capability manifest, and an audit-grade event log. The spine that every future AWIP module hangs off.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 mt-12">
            <Link
              to={authed ? "/tenants" : "/auth"}
              className="px-6 py-3 bg-[#c9a84c] text-[#0d0d0d] font-bold text-sm tracking-wide transition-all hover:bg-[#f0d78c]"
            >
              {authed ? "OPEN OPERATOR CONSOLE" : "SIGN IN"}
            </Link>
            <Link
              to="/capabilities"
              className="px-6 py-3 border border-[#c9a84c]/40 text-[#c9a84c] font-bold text-sm tracking-wide transition-all hover:bg-[#c9a84c]/10 hover:border-[#c9a84c]"
            >
              CAPABILITY MANIFEST
            </Link>
          </div>
        </div>

        {/* OKR Tree Preview Tile */}
        <div className="bg-[#1a1a1a] border border-[#c9a84c]/10 p-6 flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">OKR.version_tree</span>
          <div className="flex-1 flex items-center justify-center py-4">
            <div className="relative flex flex-col items-center">
              <div className="w-12 h-6 border border-[#c9a84c] bg-[#c9a84c]/10 mb-4" />
              <div className="w-px h-6 bg-[#c9a84c]/30 mb-4" />
              <div className="flex gap-4">
                <div className="w-10 h-6 border border-white/20 bg-white/5" />
                <div className="w-10 h-6 border border-white/20 bg-white/5" />
              </div>
            </div>
          </div>
          <div className="flex justify-between items-end">
            <span className="text-2xl font-['Sora'] text-[#f0d78c]">v2.4.0</span>
            <span className="text-[10px] text-white/20">STABLE</span>
          </div>
        </div>

        {/* Capability Count Tile */}
        <Link to="/capabilities" className="bg-[#1a1a1a] border border-[#c9a84c]/10 p-6 flex flex-col justify-between transition-colors hover:border-[#c9a84c]/40">
          <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Manifest.index</span>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-6xl font-['Sora'] font-light text-[#c9a84c] tabular-nums">
              {capCount === null ? "—" : capCount.toString().padStart(3, "0")}
            </div>
          </div>
          <div className="flex justify-between items-center text-[10px] tracking-tight">
            <span className="text-white/40">PROVISIONED NODES</span>
            <span className="text-green-500/80">ACTIVE</span>
          </div>
        </Link>

        {/* Audit Sparkline Tile */}
        <div className="md:col-span-2 bg-[#1a1a1a] border border-[#c9a84c]/10 p-6 flex flex-col justify-between overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Audit.stream_vol</span>
            <span className="text-[10px] text-[#c9a84c] tabular-nums tracking-widest">{totalPerHour} EVENTS/H</span>
          </div>
          <div className="flex items-end h-24 gap-1.5">
            {hourlyBuckets.map((v, i) => {
              const pct = Math.max(4, Math.round((v / maxBucket) * 100));
              const peak = v === maxBucket && v > 0;
              return (
                <div
                  key={i}
                  className={peak ? "flex-1 bg-[#c9a84c]/20 border-t border-[#c9a84c]" : "flex-1 bg-white/5"}
                  style={{ height: `${pct}%` }}
                />
              );
            })}
            {hourlyBuckets.length === 0 &&
              Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex-1 bg-white/5" style={{ height: "20%" }} />
              ))}
          </div>
        </div>

        {/* Last Event Ticker Tile */}
        <div className="md:col-span-2 bg-[#1a1a1a] border border-[#c9a84c]/10 p-6 flex items-center justify-between">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-1">Sentinel.last_event</span>
            <code className="text-xs text-[#f0d78c]/80 font-mono truncate">{eventLabel}</code>
          </div>
          <div className="text-right shrink-0 ml-4">
            <div className="text-xl font-['Sora'] font-medium text-white/80 tabular-nums">{timeLabel}</div>
            <span className="text-[10px] text-white/20 uppercase tracking-widest">UTC SYNC</span>
          </div>
        </div>

        {/* Sub-status Tiles */}
        <div className="bg-[#1a1a1a] border border-[#c9a84c]/10 p-4 flex items-center gap-4">
          <div className="w-2 h-2 rounded-full bg-[#c9a84c] animate-pulse" />
          <div>
            <div className="text-[10px] text-white/30 uppercase tracking-widest">Substrate</div>
            <div className="text-xs font-semibold text-white/70">NOMINAL</div>
          </div>
        </div>

        <Link to="/governance" className="bg-[#1a1a1a] border border-[#c9a84c]/10 p-4 flex items-center gap-4 transition-colors hover:border-[#c9a84c]/40">
          <div className="w-2 h-2 rounded-full bg-blue-500/50" />
          <div>
            <div className="text-[10px] text-white/30 uppercase tracking-widest">Governance</div>
            <div className="text-xs font-semibold text-white/70">DAO_ROOT</div>
          </div>
        </Link>

      </div>
    </main>
  );
};

export default Index;

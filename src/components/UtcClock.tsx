import { useEffect, useState } from "react";

const fmt = (d: Date) => {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export default function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="font-mono text-xs tabular-nums px-2 py-1 rounded border border-border bg-muted/30 text-foreground"
      title="Current UTC time"
    >
      {fmt(now)} <span className="text-muted-foreground">UTC</span>
    </span>
  );
}

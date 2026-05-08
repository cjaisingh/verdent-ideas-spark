import { useEffect, useState } from "react";

export type Viewport = "mobile" | "narrow" | "wide";

const NARROW_BP = 768; // below this is mobile (matches use-mobile.tsx)
const WIDE_BP = 1024; // below this is "narrow" (tablet / small laptop)

function read(): Viewport {
  if (typeof window === "undefined") return "wide";
  const w = window.innerWidth;
  if (w < NARROW_BP) return "mobile";
  if (w < WIDE_BP) return "narrow";
  return "wide";
}

export function useViewport(): Viewport {
  const [v, setV] = useState<Viewport>(read);
  useEffect(() => {
    const onResize = () => setV(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return v;
}

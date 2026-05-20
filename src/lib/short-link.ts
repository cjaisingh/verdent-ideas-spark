import { supabase } from "@/integrations/supabase/client";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l for legibility
const SLUG_LEN = 7;

function randomSlug(): string {
  const bytes = new Uint8Array(SLUG_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < SLUG_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalKey(path: string, query: Record<string, string>): string {
  const keys = Object.keys(query).sort();
  const qs = keys.map((k) => `${k}=${query[k]}`).join("&");
  return `${path}?${qs}`;
}

/**
 * Shorten a full app URL into a /s/<slug> link. Deduplicates on the
 * canonical path+query so the same deep link always returns the same slug.
 * Falls back to the original URL on any failure (auth, network, RLS).
 */
export async function shortenAppUrl(fullUrl: string): Promise<string> {
  try {
    const u = new URL(fullUrl);
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    const hash = await sha256Hex(canonicalKey(u.pathname, query));

    // Try to find existing slug first (read is cheap, avoids RLS noise on insert).
    const { data: existing } = await supabase
      .from("short_links")
      .select("slug")
      .eq("target_hash", hash)
      .maybeSingle();

    let slug = existing?.slug;

    if (!slug) {
      const candidate = randomSlug();
      const { data, error } = await supabase
        .from("short_links")
        .insert({
          slug: candidate,
          target_path: u.pathname,
          target_query: query,
          target_hash: hash,
        })
        .select("slug")
        .single();

      if (error) {
        // Race: another tab inserted the same hash between our read and write.
        const { data: retry } = await supabase
          .from("short_links")
          .select("slug")
          .eq("target_hash", hash)
          .maybeSingle();
        slug = retry?.slug;
      } else {
        slug = data?.slug;
      }
    }

    if (!slug) return fullUrl;
    return `${u.origin}/s/${slug}`;
  } catch {
    return fullUrl;
  }
}

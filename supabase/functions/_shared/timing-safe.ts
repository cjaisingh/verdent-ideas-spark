// Constant-time comparison for secret / service-token checks.
//
// A plain `a === b` on strings short-circuits at the first differing byte, so
// response latency leaks how many leading bytes an attacker guessed correctly —
// enough to enumerate a token one byte at a time. These helpers compare in time
// proportional to the input length only (a length mismatch still returns early;
// that leaks length, which is standard and not sensitive for fixed-length tokens).

const encoder = new TextEncoder();

export function timingSafeEqual(a: string, b: string): boolean {
  const ba = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// True only when a non-empty secret is configured AND the provided value matches
// it in constant time. An unset/empty expected secret never matches.
export function tokenMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || !provided) return false;
  return timingSafeEqual(provided, expected);
}

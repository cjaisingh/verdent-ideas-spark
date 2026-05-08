// Night-cheap model policy. Between 22:00 and 06:00 UTC every AI job falls back
// to the cheapest tier. Use `pickModel(daytimeModel)` for normal calls, or
// `pickModel(daytimeModel, { force: true })` for jobs that should always be cheap
// (e.g. the overnight phase runner).
export const NIGHT_MODEL = "google/gemini-2.5-flash-lite";

export function isNightUTC(d: Date = new Date()): boolean {
  const h = d.getUTCHours();
  return h >= 22 || h < 6;
}

export function pickModel(daytime: string, opts: { force?: boolean; now?: Date } = {}): string {
  if (opts.force) return NIGHT_MODEL;
  return isNightUTC(opts.now) ? NIGHT_MODEL : daytime;
}

export function nightMeta(model: string): { night_mode: boolean } {
  return { night_mode: model === NIGHT_MODEL && isNightUTC() };
}

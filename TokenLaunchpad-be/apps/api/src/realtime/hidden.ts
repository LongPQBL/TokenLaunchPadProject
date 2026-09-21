export interface HiddenTokensOptions {
  /** The hidden tokens right now, as `<chain slug>:<lower-case address>`. */
  load: () => Promise<string[]>;
  everyMs: number;
  onError?: (error: unknown) => void;
}

/**
 * A copy of "which tokens are hidden", kept fresh on a timer, for the realtime server to check on every message without
 * asking the database each time. A failed load keeps the LAST list: a database blip must not let hidden tokens through.
 * Another API instance's hide shows up here within one interval; pages already open are told at once by the event instead.
 */
export function createHiddenTokens({ load, everyMs, onError = (e) => console.error(e) }: HiddenTokensOptions) {
  let current: ReadonlySet<string> = new Set();
  const refresh = async () => {
    try {
      current = new Set(await load());
    } catch (e) {
      onError(e);
    }
  };
  const timer = setInterval(() => void refresh(), everyMs);
  timer.unref?.();
  return { get: () => current, refresh, stop: () => clearInterval(timer) };
}

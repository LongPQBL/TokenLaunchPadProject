/** Marks the one control in the header that starts logging in (Privy's Log in, or the plain Connect wallet). */
export const LOGIN_TRIGGER = { "data-login-trigger": "" } as const;

/**
 * Starts logging in from somewhere other than the header, by pressing the header's own control: whichever way this build gets a
 * person in (Privy's screen, or the wallet list) is what opens, with nothing here needing to know which. Returns false if there is
 * no such control to press (the page has none, or it is not ready yet, and a disabled button does nothing when pressed).
 */
export function requestLogin(): boolean {
  const trigger = document.querySelector<HTMLElement>("[data-login-trigger]:not(:disabled)");
  trigger?.click();
  return !!trigger;
}

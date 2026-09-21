/** What people who have a page open are told when a moderator acts. Only what they need to stop showing something. */
export type ModerationEvent =
  | { type: "token_hidden"; chain: string; token: string }
  | { type: "comments_hidden"; chain: string; token: string; ids: string[] };

export type ModerationPublisher = (event: ModerationEvent) => Promise<void>;

/**
 * Tells the rooms that could be showing the thing. A hidden token leaves the discover grid (the `tokens` room), the trade strip
 * (`trades`) and its own page (its room); hidden comments only matter on their token's page. Best-effort like the comment
 * publisher: the change is made whether or not anyone is told live, and a Redis outage must never fail the moderator's request.
 * Nothing about WHO acted or why is sent.
 */
export function createModerationPublisher(
  publish: ((channel: string, message: string) => Promise<unknown>) | undefined,
  onError: (error: unknown) => void = (e) => console.error(e),
): ModerationPublisher {
  return async (event) => {
    if (!publish) return;
    const token = event.token.toLowerCase();
    const message = JSON.stringify({ ...event, token });
    const channels = event.type === "token_hidden" ? ["tokens", "trades", `token:${event.chain}:${token}`] : [`token:${event.chain}:${token}`];
    for (const channel of channels) {
      try {
        await publish(channel, message);
      } catch (e) {
        onError(e);
      }
    }
  };
}
